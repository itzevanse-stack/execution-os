// api/vpe-atp.mjs
// AnswerThePublic integration for the Value Post Engine.
// Used specifically to fill the gap Google/YouTube/Bing/Amazon Suggest can't
// reach for free: TikTok, Instagram, ChatGPT, and Gemini search behavior.
//
// Fully spec'd against AnswerThePublic's official OpenAPI doc (v1.0.0-alpha):
//   - Auth, POST /searches, GET /searches/{id} are implemented exactly as documented.
//   - GET /reports/{id}'s `data` field is documented as `additionalProperties: true`
//     with NO field names specified in the spec — this is a genuine gap in ATP's
//     own docs, not a guess on our part. parseReportRows() below tries several
//     reasonable shapes defensively and logs the raw shape if none match, so
//     nothing crashes — but the exact mapping needs to be confirmed against one
//     real response before this is 100% locked in.
//
// Gracefully disabled (returns []) if ATP_API_TOKEN is not set — never breaks
// the free Google/YouTube/Bing/Amazon/Tavily flow in vpe-questions.mjs.

const ATP_BASE = 'https://api.answerthepublic.com/api/public/v1';

// Providers ATP is used for — deliberately NOT gweb/youtube/bing/amazon since
// those are already covered for free elsewhere. This keeps credit usage down
// and gets genuinely new coverage instead of duplicate data.
const ATP_PROVIDERS = ['tiktok', 'instagram', 'chatgpt', 'gemini'];

function atpHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// Creates (or reuses, via ATP's 24h dedupe window) a parent search across
// the target providers. Returns the ParentSearch payload with per-provider
// searches[] — some may already carry an inlined snapshot on a dedupe hit.
async function createSearch(token, keyword) {
  const resp = await fetch(`${ATP_BASE}/searches`, {
    method: 'POST',
    headers: atpHeaders(token),
    body: JSON.stringify({
      search: {
        keyword,
        language: 'en',
        region: 'us',
        // No `provider` field = fans out across ALL providers. We want only
        // ATP_PROVIDERS, so instead we create one search per provider below
        // rather than relying on a filter that doesn't exist on this endpoint.
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`ATP createSearch failed (${resp.status}): ${body?.error?.message || resp.statusText}`);
  }
  const json = await resp.json();
  return json.data;
}

// Create one search per target provider (the API only supports a single
// `provider` string per call, not a list — so we fire ATP_PROVIDERS.length
// requests in parallel, each independently hitting the 24h dedupe cache).
async function createProviderSearches(token, keyword) {
  const results = await Promise.allSettled(
    ATP_PROVIDERS.map(provider =>
      fetch(`${ATP_BASE}/searches`, {
        method: 'POST',
        headers: atpHeaders(token),
        body: JSON.stringify({ search: { keyword, language: 'en', region: 'us', provider } }),
      })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(`ATP ${provider} search failed (${r.status}): ${body?.error?.message || r.statusText}`);
        }
        return r.json();
      })
      .then(j => ({ provider, data: j.data }))
    )
  );

  const searches = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      // POST /searches (with provider set) still returns a ParentSearch shape
      // with a searches[] array — should contain exactly one entry for that provider.
      const entries = (r.value.data.searches || []);
      for (const e of entries) searches.push({ ...e, provider: e.provider || r.value.provider });
    } else {
      console.warn('[vpe-atp] provider search failed:', r.reason?.message || r.reason);
    }
  }
  return searches;
}

// Poll GET /searches/{id} for each provider-specific search until it
// completes or the time budget runs out. Bounded so a live user-facing
// request never hangs waiting on ATP's background pipeline — on repeat
// requests within 24h the dedupe cache usually makes this instant anyway.
async function pollUntilReady(token, searches, { timeoutMs = 7000, intervalMs = 1000 } = {}) {
  const pending = new Map(searches.filter(s => s.status !== 'completed').map(s => [s.id, s]));
  const ready   = searches.filter(s => s.status === 'completed');

  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    const checks = await Promise.allSettled(
      Array.from(pending.keys()).map(id =>
        fetch(`${ATP_BASE}/searches/${id}`, { headers: atpHeaders(token) })
          .then(r => r.json())
          .then(j => ({ id, ...j.data }))
      )
    );
    for (const c of checks) {
      if (c.status !== 'fulfilled') continue;
      const { id, status, snapshot, search } = c.value;
      if (status === 'completed') {
        ready.push({ id, provider: search?.provider, status, snapshot });
        pending.delete(id);
      } else if (status === 'failed') {
        pending.delete(id); // give up on this one, don't block the others
      }
    }
    if (pending.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  return ready; // whatever completed in time; partial results are fine
}

// Fetch the structured report for a completed search, filtered to the
// "questions" source bucket — exactly the shape the VPE wants.
async function fetchQuestionsReport(token, searchId) {
  const url = `${ATP_BASE}/reports/${searchId}?source_name=questions&per_page=50`;
  const resp = await fetch(url, { headers: atpHeaders(token) });
  if (!resp.ok) return null;
  const json = await resp.json();
  return json.data;
}

// ── DEFENSIVE PARSER ─────────────────────────────────────────────────────
// The report `data` shape is NOT documented in ATP's spec (additionalProperties:
// true, no field names given). This tries several plausible shapes rather than
// assuming one. If none match, it logs the actual top-level keys so the real
// shape can be confirmed from a live response and this function tightened up.
function parseReportRows(data) {
  if (!data) return [];

  const candidateArrays = [
    data.keywords,
    data.results,
    data.items,
    data.rows,
    Array.isArray(data) ? data : null,
  ].filter(Array.isArray);

  const rows = candidateArrays[0] || [];
  if (!rows.length) {
    console.warn('[vpe-atp] Could not find a keyword array in report response. Top-level keys:', Object.keys(data));
    return [];
  }

  return rows.map(row => ({
    // Try the most likely field names; fall back gracefully rather than crash.
    question: row.keyword || row.question || row.text || row.term || '',
    volume:   row.volume ?? row.search_volume ?? null,
    intent:   row.intent || '',
    category: row.category || row.question_word || '',
  })).filter(r => r.question);
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────
// Returns { questions: [{question, provider, volume, intent, category}], usedProviders: [] }
// Never throws — any failure results in an empty array so the caller's
// existing free sources (Google/YouTube/Bing/Amazon/Tavily) are unaffected.
export async function getATPQuestions(keyword) {
  const token = process.env.ATP_API_TOKEN;
  if (!token) return { questions: [], usedProviders: [], skipped: 'no ATP_API_TOKEN configured' };

  try {
    const providerSearches = await createProviderSearches(token, keyword);
    if (!providerSearches.length) return { questions: [], usedProviders: [] };

    const readySearches = await pollUntilReady(token, providerSearches);
    if (!readySearches.length) {
      return { questions: [], usedProviders: [], skipped: 'no providers completed within time budget' };
    }

    const allQuestions = [];
    const usedProviders = [];
    for (const s of readySearches) {
      const report = await fetchQuestionsReport(token, s.id);
      const rows = parseReportRows(report);
      if (rows.length) {
        usedProviders.push(s.provider);
        for (const row of rows) {
          allQuestions.push({ ...row, provider: s.provider });
        }
      }
    }

    return { questions: allQuestions, usedProviders };
  } catch (err) {
    console.error('[vpe-atp] Error:', err.message);
    return { questions: [], usedProviders: [], error: err.message };
  }
}
