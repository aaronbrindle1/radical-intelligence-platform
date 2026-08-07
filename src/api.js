// ─── src/api.js — All API and data-fetch logic ───────────────────────────────
import { BOOLEAN_QUERIES, BLOCKED_DOMAINS, DATE_RANGES } from "./data.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

export async function bustCompanyCache(companyName) {
  if (!companyName) return;
  try {
    await fetch(
      `http://localhost:3001/cache-bust?company=${encodeURIComponent(companyName)}`,
      { method: "DELETE" }
    );
  } catch {}
}

export function dateRangeFrom(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const POS_WORDS = ["launch","launches","launched","raises","raised","funding","invest","investment",
  "partnership","partner","expand","expansion","milestone","breakthrough","innovation",
  "award","wins","record","growth","growing","surpass","exceed","advance","leading",
  "leads","first","top","best","strong","revenue","profit","hire","hires","hiring"];
const NEG_WORDS = ["layoff","layoffs","lawsuit","fail","fails","failed","failure","decline",
  "declining","struggle","struggling","concern","risk","breach","hacked","fraud",
  "investigation","resign","cut","cuts","loss","losses","recall","ban","blocked",
  "controversy","backlash","criticism","problem","trouble","slump","drop","fired",
  "shutdown","bankrupt","collapse","warning","delay","delays","miss","missed"];

export function quickSentiment(title = "", snippet = "") {
  const t = `${title} ${snippet}`.toLowerCase();
  let score = 0;
  POS_WORDS.forEach(w => { if (t.includes(w)) score += 0.15; });
  NEG_WORDS.forEach(w => { if (t.includes(w)) score -= 0.2; });
  return Math.max(-1, Math.min(1, score));
}

export function parseJSON(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

// ── LLM caller (Vertex → Gemini → Anthropic → Cohere) ────────────────────────

export async function callLLM(userPrompt, systemPrompt, apiKeys) {
  const { vertex_enabled, gemini, cohere_north_key, cohere_north_hostname,
          cohere_north_model, cohere, anthropic } = apiKeys || {};

  const tryVertex = async () => {
    if (vertex_enabled === false) return null;
    const body = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    };
    const r = await fetch(
      "http://localhost:3001/vertex/v1/projects/velvety-argon-494701-g1/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  };

  const tryGemini = async () => {
    if (!gemini) return null;
    const body = {
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    };
    const r = await fetch(
      `http://localhost:3001/gemini/v1beta/models/gemini-2.5-flash:generateContent?key=${gemini}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  };

  const tryAnthropic = async () => {
    if (!anthropic) return null;
    const r = await fetch("http://localhost:3001/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.content?.[0]?.text || null;
  };

  const tryCohereNorth = async () => {
    if (!cohere_north_key) return null;
    const host = cohere_north_hostname || "radical.cloud.cohere.com";
    const model = cohere_north_model || "command-r-plus";
    const r = await fetch("http://localhost:3001/cohere/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cohere_north_key}`,
        "X-North-Hostname": host,
      },
      body: JSON.stringify({ model, preamble: systemPrompt, message: userPrompt, temperature: 0.1, max_tokens: 1024 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.text || null;
  };

  const tryCoherePublic = async () => {
    if (!cohere) return null;
    const r = await fetch("http://localhost:3001/cohere-public/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cohere}` },
      body: JSON.stringify({ model: "command-r-plus", preamble: systemPrompt, message: userPrompt, temperature: 0.1, max_tokens: 1024 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.text || null;
  };

  for (const fn of [tryVertex, tryGemini, tryAnthropic, tryCohereNorth, tryCoherePublic]) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
  }
  return null;
}

// ── Parse NOT phrases from a boolean query for client-side enforcement ────────

function extractNotPhrases(query) {
  // Matches: NOT "phrase" or NOT phrase (unquoted single word)
  const quoted   = [...(query || "").matchAll(/NOT\s+"([^"]+)"/gi)].map(m => m[1].toLowerCase());
  const unquoted = [...(query || "").matchAll(/NOT\s+(?!")([^\s)]+)/gi)].map(m => m[1].toLowerCase());
  return [...quoted, ...unquoted];
}

function passesNotFilter(article, notPhrases) {
  if (!notPhrases.length) return true;
  const text = `${article.title || ""} ${article.description || ""} ${article.content || ""}`.toLowerCase();
  return !notPhrases.some(phrase => text.includes(phrase));
}

// ── NewsAPI fetch (5 parallel pages for maximum coverage) ────────────────────

// Number formatter (shared with App.jsx)
const fmt = n => { if (!n && n !== 0) return "—"; const a = Math.abs(n); return a >= 1e9 ? `${(n/1e9).toFixed(1)}B` : a >= 1e6 ? `${(n/1e6).toFixed(1)}M` : a >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n); };

export async function fetchNews(company, fromDate, newsKey, outlets = []) {
  if (!newsKey) return [];

  const query = company.boolean_query || `"${company.name}"`;
  const simpleQuery = `"${company.name}"`;
  // Extract NOT phrases once — applied client-side to every result including fallback
  const notPhrases = extractNotPhrases(query);

  const buildUrl = (page, sortBy, q) =>
    `http://localhost:3001/newsapi/v2/everything?q=${encodeURIComponent(q)}&from=${fromDate}&sortBy=${sortBy}&pageSize=100&page=${page}&language=en&apiKey=${newsKey}`;

  const fetchPage = async (page, sortBy, q) => {
    try {
      const r = await fetch(buildUrl(page, sortBy, q));
      const d = JSON.parse(await r.text());
      return d.status === "ok" && Array.isArray(d.articles) ? d.articles : [];
    } catch { return []; }
  };

  const [a1, a2, a3, a4, a5] = await Promise.all([
    fetchPage(1, "relevancy", query),
    fetchPage(2, "relevancy", query),
    fetchPage(3, "relevancy", query),
    fetchPage(1, "publishedAt", query),
    fetchPage(2, "publishedAt", query),
  ]);

  const seen = new Set();
  let articles = [...a1, ...a2, ...a3, ...a4, ...a5].filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url); return true;
  });

  // Fallback to simple name search if boolean query returns nothing.
  // Keep NOT phrases from the original query so the fallback doesn't
  // re-introduce articles that were explicitly excluded.
  if (articles.length === 0 && query !== simpleQuery) {
    console.log(`[news] Boolean query 0 results — retrying with simple query (NOT phrases still enforced client-side)`);
    const [b1, b2, b3, b4] = await Promise.all([
      fetchPage(1, "relevancy", simpleQuery),
      fetchPage(2, "relevancy", simpleQuery),
      fetchPage(1, "publishedAt", simpleQuery),
      fetchPage(2, "publishedAt", simpleQuery),
    ]);
    const seen2 = new Set();
    articles = [...b1, ...b2, ...b3, ...b4].filter(a => {
      if (!a.url || seen2.has(a.url)) return false;
      seen2.add(a.url); return true;
    });
  }

  // Build tier lookup from outlets list — by name AND domain
  const tierByName = {};
  const tierByDomain = {};
  outlets.forEach(o => {
    const k = (o.name || "").toLowerCase();
    tierByName[k] = o.tier || 2;
    tierByName[k.replace(/^the\s+/, "")] = o.tier || 2;
    if (o.domain) tierByDomain[o.domain.replace(/^www\./, "")] = o.tier || 2;
  });
  // Comprehensive alias map covering all known NewsAPI source name variants
  const TIER_ALIASES = {
    // Tier 1 — Major news
    "nyt": 1, "new york times": 1, "the new york times": 1, "nytimes": 1,
    "wsj": 1, "wall street journal": 1, "the wall street journal": 1,
    "washington post": 1, "the washington post": 1, "wapo": 1,
    "financial times": 1, "ft": 1, "ft.com": 1, "financial times (ft)": 1,
    "bloomberg": 1, "bloomberg news": 1, "bloomberg businessweek": 1, "bloomberg technology": 1, "bloomberg law": 1,
    "the information": 1, "theinformation": 1, "theinformation.com": 1,
    "tbpn": 1, "tbpn.com": 1,
    "reuters": 1, "reuters.com": 1, "associated press": 1, "ap": 1, "ap news": 1, "apnews": 1,
    "bbc": 1, "bbc news": 1, "bbc.com": 1, "bbc.co.uk": 1,
    "guardian": 1, "the guardian": 1,
    "cnbc": 1, "cnbc.com": 1,
    "forbes": 1, "forbes.com": 1,
    "fortune": 1, "fortune.com": 1,
    "the atlantic": 1, "atlantic": 1,
    "business insider": 2, "businessinsider": 2, "insider": 2,
    "yahoo finance": 1, "yahoo! finance": 1,
    "marketwatch": 1,
    "barron's": 1, "barrons": 1,
    "usa today": 1, "usatoday": 1,
    "los angeles times": 1, "la times": 1, "latimes": 1,
    "time": 1, "time magazine": 1, "time.com": 1,
    "newsweek": 1, "newsweek.com": 1,
    "the economist": 1, "economist": 1,
    "politico": 1, "politico.com": 1,
    "axios": 1, "axios.com": 1,
    "mit technology review": 1, "technology review": 1, "technologyreview": 1,
    "quanta magazine": 1, "quantamagazine": 1,
    "scientific american": 1,
    "nature": 1, "nature.com": 1,
    "south china morning post": 1, "scmp": 1,
    "globe and mail": 1, "the globe and mail": 1,
    "nikkei asia": 1, "nikkei": 1,
    "harvard business review": 1, "hbr": 1,
    "seeking alpha": 1,
    "msn": 1, "msn.com": 1,
    // Tier 1 — Core tech (primary outlets)
    "techcrunch": 1, "techcrunch.com": 1,
    "wired": 1, "wired.com": 1,
    "the verge": 1, "verge": 1, "theverge.com": 1,
    // Tier 2 — secondary tech
    "venturebeat": 2, "ars technica": 2, "arstechnica": 2,
    "cnet": 2, "zdnet": 2, "geekwire": 2, "fast company": 2, "fastcompany": 2,
    "engadget": 2, "the information": 2, "the register": 2, "register": 2,
    "siliconangle": 2, "silicon angle": 2, "techrepublic": 2,
    "computerworld": 2, "infoq": 2, "digiday": 2, "gizmodo": 2, "mashable": 2,
    "rest of world": 2, "restofworld": 2, "morning brew": 2,
    "pitchbook": 2, "crunchbase": 2, "crunchbase news": 2, "cb insights": 2,
    "betakit": 2, "financial post": 2, "cbc": 2, "cbc news": 2,
    "the decoder": 2, "stratechery": 2, "semianalysis": 2, "venturebeat": 2,
    "ai business": 2, "unite.ai": 2,
    "times of india": 2, "the times of india": 2,
    "siliconangle news": 2, "siliconangle": 2,
    "science daily": 2, "sciencedaily": 2,
    "new york post": 2, "nypost": 2,
    "search engine journal": 2,
    "financial post": 2,
    "cna": 2,
    // Blocked source name variants seen in debug output
    "pypi.org": null, "wiley.com": null, "trailcooking.com": null,
    "livedoor.com": null, "amazon.com": null, "protothema.gr": null,
    "wolfram.com": null, "unity.com": null, "manrepeller.com": null,
    "literatumonline.com": null, "semrush.com": null, "alltoc.com": null,
    "lastwatchdog.com": null, "thepinknews.com": null,
    "cryptoslate": null, "crypto briefing": null, "cryptobriefing": null,
    "bleeding cool news": null, "kotaku": null, "kotaku australia": null,
    "eurogamer.net": null, "uploadvr": null, "4sysops.com": null,
    "slashdot.org": null, "wccftech": null, "nvidia.com": null,
    "microsoft.com": null, "sciencedaily": null, "phys.org": null,
    "the points guy": null, "azcentral": null, "prnewswire": null,
    "globenewswire": null, "nakedcapitalism.com": null,
    "pymnts.com": null, "d magazine": null,
    // Tier 3 — lower quality but not blocked
    "next big future": 3, "daemonology": 3, "forkast": 3, "forkast.news": 3,
    // Blocked — null means filter out entirely
    "breitbart": null, "breitbart news": null, "breitbart.com": null,
    "newsmax": null, "oann": null, "one america news": null,
    "the gateway pundit": null, "daily wire": null, "natural news": null,
    "infowars": null, "rumble": null,
    "pr newswire": null, "prnewswire": null, "business wire": null,
    "businesswire": null, "globe newswire": null, "globenewswire": null,
    "accesswire": null, "einpresswire": null, "send2press": null,
  };

  const getTier = (name, url) => {
    const k = (name || "").toLowerCase().trim();
    // 1. Check explicit alias map
    if (k in TIER_ALIASES) {
      const t = TIER_ALIASES[k];
      return t === null ? 99 : t;
    }
    // 2. Check name without "the " prefix
    const kNoThe = k.replace(/^the\s+/, "");
    if (kNoThe in TIER_ALIASES) {
      const t = TIER_ALIASES[kNoThe];
      return t === null ? 99 : t;
    }
    // 3. Check tier maps built from DEFAULT_OUTLETS
    const byName = tierByName[k] || tierByName[kNoThe];
    if (byName) return byName;
    // 4. Domain-based fallback from URL
    if (url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        if (host in TIER_ALIASES) {
          const t = TIER_ALIASES[host];
          return t === null ? 99 : t;
        }
        const byDomain = tierByDomain[host];
        if (byDomain) return byDomain;
        // Partial match for subdomains
        const partial = Object.keys(tierByDomain).find(d => host.endsWith(d));
        if (partial) return tierByDomain[partial];
      } catch {}
    }
    return 2; // Default to tier 2 for unknown outlets
  };

  // ── Google News RSS — fetch multiple queries for full coverage ───────────────
  // Google News RSS only returns ~10 results per query, so we run 3 parallel
  // queries with different sort/time parameters to maximize coverage
  const [gn1, gn2, gn3, gn4] = await Promise.all([
    fetchGoogleNewsRSS(simpleQuery, notPhrases),
    fetchGoogleNewsRSS(simpleQuery + " when:7d", notPhrases),
    fetchGoogleNewsRSS(simpleQuery + " after:2026-07-01", notPhrases),
    fetchGoogleNewsRSS(simpleQuery + " source:Financial Times OR source:New York Times OR source:Wall Street Journal OR source:Bloomberg", notPhrases),
  ]);
  const gnSeen = new Set();
  const gnArticles = [...gn1, ...gn2, ...gn3, ...gn4].filter(a => {

    if (!a.url || gnSeen.has(a.url)) return false;
    gnSeen.add(a.url); return true;
  });
  console.log("[Google News RSS] total deduped:", gnArticles.length, "from", gnArticles.length ? [...new Set(gnArticles.map(a=>a.source))].join(", ") : "none");

  // Merge NewsAPI + Google News, deduplicate by URL
  const allArticles = [...articles, ...gnArticles];
  const seenUrls = new Set();
  const merged = allArticles.filter(a => {
    if (!a.url || seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    return true;
  });

  // Build relevance keywords from the company name and query
  const companyWords = company.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const queryWords = simpleQuery.toLowerCase().replace(/['"]/g, "").split(/\s+/).filter(w => w.length > 3);
  const relevanceWords = [...new Set([...companyWords, ...queryWords])];

  const isRelevant = (a) => {
    // NewsAPI articles are pre-filtered by query — always relevant
    if (a.via !== "google-news") return true;
    // Google News RSS: check title and date for relevance
    const title = (a.title || "").toLowerCase();
    const hasRelevantWord = relevanceWords.some(w => title.includes(w));
    // Also enforce date filter for Google News articles
    if (fromDate && a.date && a.date < fromDate) return false;
    return hasRelevantWord;
  };

  return merged
    .filter(a => !BLOCKED_DOMAINS.some(d => (a.url || "").toLowerCase().includes(d)))
    .filter(a => passesNotFilter(a, notPhrases))
    .filter(a => getTier(a.source?.name, a.url) !== 99)
    .filter(a => isRelevant(a))
    .slice(0, 500)
    .map((a, i) => {
      const src = a.source?.name || a.source || "Unknown";
      const rawTitle = a.title || "";
      const title = (rawTitle === "[Removed]" || rawTitle === "")
        ? `Coverage in ${src}` : rawTitle;
      const snippet = a.description || a.snippet || a.content?.slice(0, 200) || "";
      return {
        id: `n-${company.id}-${Date.now()}-${i}`,
        source: src,
        tier: getTier(src, a.url),
        title, snippet,
        url: a.url || "",
        date: (a.publishedAt || a.date || "").slice(0, 10),
        sentiment: quickSentiment(title, snippet),
        isLive: true,
        paywalled: rawTitle === "[Removed]",
        via: a.via || "newsapi",
      };
    });
}

// ── Google News RSS fetch ─────────────────────────────────────────────────────
// Fetches Google News RSS via proxy and parses articles with source/title/url/date.
// No API key required. Supplements NewsAPI with NYT, WSJ, FT, and other paywalled outlets.

async function fetchGoogleNewsRSS(query, notPhrases = []) {
  try {
    const res = await fetch(`http://localhost:3001/gnews?q=${encodeURIComponent(query)}`);
    if (!res.ok) { console.warn("[Google News RSS] proxy error:", res.status); return []; }
    const xml = await res.text();
    if (!xml || xml.length < 100) { console.warn("[Google News RSS] empty response"); return []; }

    const items = [];
    const parts = xml.split("<item>").slice(1);

    for (const raw of parts) {
      // Title — strip " - Source Name" suffix that Google appends
      const titleM = raw.match(/<title[^>]*>([^<]+)<\/title>/);
      if (!titleM) continue;
      const fullTitle = titleM[1].replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();

      // Source — from <source url="https://...">Source Name</source>
      const srcM = raw.match(/<source\s+url="([^"]+)">([^<]+)<\/source>/);
      const sourceUrl = srcM ? srcM[1].trim() : "";
      const sourceName = srcM ? srcM[2].trim() : "";

      // Strip " - Source Name" from title end
      const title = fullTitle.replace(/ - [^-]+$/, "").trim() || fullTitle;

      // Google News link (redirect URL) — use as the clickable URL
      const linkM = raw.match(/<link>([^<]+)<\/link>/);
      const link = linkM ? linkM[1].trim() : "";

      // Date
      const dateM = raw.match(/<pubDate>([^<]+)<\/pubDate>/);
      let date = "";
      try { if (dateM) date = new Date(dateM[1].trim()).toISOString().slice(0, 10); } catch {}

      // Google News descriptions are just HTML links — use empty snippet (title is sufficient)
      const snippet = "";

      if (!title || !link) continue;
      if (!passesNotFilter({ title, description: snippet }, notPhrases)) continue;

      // Use source URL domain to get proper name if srcM missing
      const finalSource = sourceName || extractDomainName(sourceUrl || link);

      items.push({ title, url: link, source: finalSource, snippet, date, via: "google-news" });
    }

    const sources = [...new Set(items.map(i=>i.source))]; console.log("[Google News RSS]", JSON.stringify(query), "->", items.length, "articles. Sources:", sources.join(", "));
    return items;
  } catch (e) {
    console.warn("[Google News RSS] Failed:", e.message);
    return [];
  }
}

function extractDomainName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Convert nytimes.com → "The New York Times" etc using a small lookup
    const DOMAIN_NAMES = {
      "nytimes.com": "The New York Times",
      "wsj.com": "The Wall Street Journal",
      "ft.com": "Financial Times",
      "bloomberg.com": "Bloomberg",
      "reuters.com": "Reuters",
      "washingtonpost.com": "The Washington Post",
      "theguardian.com": "The Guardian",
      "economist.com": "The Economist",
      "forbes.com": "Forbes",
      "fortune.com": "Fortune",
      "cnbc.com": "CNBC",
      "techcrunch.com": "TechCrunch",
      "wired.com": "Wired",
      "theverge.com": "The Verge",
      "axios.com": "Axios",
      "apnews.com": "Associated Press",
      "bbc.com": "BBC News", "bbc.co.uk": "BBC News",
      "businessinsider.com": "Business Insider",
      "technologyreview.com": "MIT Technology Review",
      "theatlantic.com": "The Atlantic",
      "ft.com": "Financial Times",
      "theinformation.com": "The Information",
      "bloomberg.com": "Bloomberg",
      "economist.com": "The Economist",
      "wsj.com": "The Wall Street Journal",
      "nytimes.com": "The New York Times",
    };
    return DOMAIN_NAMES[host] || host;
  } catch { return "Unknown"; }
}

// ── Yutori Scout (persistent background monitor) ──────────────────────────────

export async function yutoriScout(company, yutoriKey) {
  const storeKey = `radical_scout_${company.id}`;
  let scoutId = localStorage.getItem(storeKey);

  if (!scoutId) {
    const r = await fetch("http://localhost:3001/yutori/v1/scouting/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": yutoriKey },
      body: JSON.stringify({
        query: `Monitor news, social media (Twitter/X, Reddit, LinkedIn, Hacker News), product updates, funding and press about "${company.name}" (${(company.categories || []).join(", ")}).`,
        output_interval: 86400,
        skip_email: true,
        output_schema: {
          type: "array",
          items: { type: "object", properties: {
            headline: { type: "string" }, summary: { type: "string" },
            source_url: { type: "string" }, platform: { type: "string" },
            date: { type: "string" }, author: { type: "string" },
          }},
        },
      }),
    });
    const d = await r.json();
    scoutId = d.task_id;
    if (scoutId) localStorage.setItem(storeKey, scoutId);
    else return [];
  }

  const r = await fetch(
    `http://localhost:3001/yutori/v1/scouting/tasks/${scoutId}/updates?page_size=50`,
    { headers: { "X-API-Key": yutoriKey } }
  );
  if (!r.ok) {
    if (r.status === 404) {
      localStorage.removeItem(storeKey);
      return yutoriScout(company, yutoriKey);
    }
    return [];
  }
  const d = await r.json();
  const items = Array.isArray(d) ? d : (d.items || d.updates || []);

  return items.filter(it => it.source_url).map((it, i) => {
    const pl = (it.platform || "web").toLowerCase();
    const platform = pl.includes("twitter") || pl.includes(" x ") ? "twitter"
                   : pl.includes("reddit") ? "reddit"
                   : pl.includes("linkedin") ? "linkedin"
                   : pl.includes("hacker") || pl === "hn" ? "hackernews"
                   : "web";
    return {
      id: `scout-${company.id}-${i}`,
      platform, author: it.author || "—",
      text: it.summary || it.headline || "",
      url: it.source_url,
      likes: 0, comments: 0,
      date: it.date || "",
      sentiment: quickSentiment(it.headline || "", it.summary || ""),
      isLive: true, source: "Yutori Scout",
    };
  });
}

// ── Yutori Research (deep one-off search, ~$0.35/run) ────────────────────────

export async function yutoriResearch(company, dateRangeId, yutoriKey, onProgress) {
  const days = DATE_RANGES.find(r => r.id === dateRangeId)?.days || 30;
  const r = await fetch("http://localhost:3001/yutori/v1/research/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": yutoriKey },
    body: JSON.stringify({
      query: `Search Twitter/X, LinkedIn, Reddit, Hacker News, and major tech publications for "${company.name}" mentions in the past ${days} days. Include recent news articles, discussions, and social posts with engagement data.`,
    }),
  });
  const d = await r.json();
  const taskId = d.task_id;
  if (!taskId) return { social: [], media: [] };

  for (let i = 0; i < 20; i++) {
    await new Promise(res => setTimeout(res, 4000));
    if (onProgress) onProgress(`Yutori Research… (${(i + 1) * 4}s)`);
    const poll = await fetch(`http://localhost:3001/yutori/v1/research/tasks/${taskId}`, {
      headers: { "X-API-Key": yutoriKey },
    });
    const pd = await poll.json();
    if (pd.status === "succeeded") {
      const SOCIAL_DOMAINS = ["twitter.com", "x.com", "reddit.com", "linkedin.com", "news.ycombinator.com", "t.co"];
      const social = [], media = [];
      (pd.citations || []).forEach((c, i) => {
        const url = c.url || "";
        const pv = c.preview_data || {};
        const isSocial = SOCIAL_DOMAINS.some(d => url.includes(d));
        const title = pv.title || url;
        const text = pv.text || "";
        if (isSocial) {
          social.push({
            id: `yr-s-${company.id}-${i}`,
            platform: url.includes("reddit") ? "reddit"
                    : url.includes("linkedin") ? "linkedin"
                    : url.includes("ycombinator") ? "hackernews" : "twitter",
            author: pv.author || "—",
            text: text || title,
            url, likes: pv.score || 0, comments: pv.comments || 0,
            date: pv.date || "",
            sentiment: quickSentiment(title, text),
            isLive: true, source: "Yutori Research",
          });
        } else {
          media.push({
            id: `yr-m-${company.id}-${i}`,
            source: pv.title || url, tier: 2,
            title, snippet: text,
            url, date: pv.date || "",
            sentiment: quickSentiment(title, text),
            isLive: true,
          });
        }
      });
      return { social, media };
    }
    if (["failed", "cancelled"].includes(pd.status)) break;
  }
  return { social: [], media: [] };
}

// ── TwitterAPI.io integration ─────────────────────────────────────────────────

export const TWITTER_COST_PER_TWEET = 0.00015;    // $0.15 per 1,000 tweets
export const TWITTER_COST_PER_CALL = 0.00015;     // minimum $0.00015 per API call

// Convert our NewsAPI boolean query format to Twitter Advanced Search syntax.
// Key differences: NOT "phrase" → -"phrase", NOT word → -word
function booleanToTwitterQuery(query) {
  if (!query) return "";
  return query
    .replace(/\bNOT\s+"([^"]+)"/gi, (_, p) => `-"${p}"`)
    .replace(/\bNOT\s+([^\s")]+)/gi, (_, p) => `-${p}`)
    .trim();
}

// Convert YYYY-MM-DD string to Unix timestamp (seconds).
// TwitterAPI.io requires since_time/until_time — the legacy since:YYYY-MM-DD
// date filter no longer works reliably for historical data.
function dateToUnix(dateStr) {
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

export async function fetchTwitter(company, fromDate, twitterKey, maxPages = 3, budgetRemainingUSD = Infinity) {
  if (!twitterKey) return { results: [], pagesUsed: 0, estimatedCost: 0 };

  const baseQuery = booleanToTwitterQuery(company.boolean_query || `"${company.name}"`);

  // Build from: clauses for the company handle + relevant accounts
  const allHandles = [
    ...(company.twitter_handle ? [company.twitter_handle] : []),
    ...(company.twitter_accounts || []),
  ].map(h => h.replace(/^@/, "")).filter(Boolean);
  const fromClause = allHandles.length
    ? ` OR (${allHandles.map(h => `from:${h}`).join(" OR ")})`
    : "";

  // Use Unix timestamp date filter (legacy since:YYYY-MM-DD no longer reliable)
  const sinceUnix = dateToUnix(fromDate);
  const fullQuery = `(${baseQuery}${fromClause}) since_time:${sinceUnix} -is:retweet`;

  const results = [];
  const seenIds = new Set(); // guard against cursor pagination duplicates
  let cursor = null;
  let pagesUsed = 0;
  let estimatedCost = 0;

  for (let page = 0; page < maxPages; page++) {
    // Each call costs at minimum TWITTER_COST_PER_CALL regardless of tweet count
    if (estimatedCost + Math.max(20 * TWITTER_COST_PER_TWEET, TWITTER_COST_PER_CALL) > budgetRemainingUSD) {
      console.log(`[twitter] Budget cap reached at page ${page}`);
      break;
    }
    try {
      const params = new URLSearchParams({ query: fullQuery, queryType: "Latest" });
      if (cursor) params.set("cursor", cursor);

      const fetchUrl = `http://localhost:3001/twitter/twitter/tweet/advanced_search?${params}`;
      console.log(`[twitter] page ${page+1} → since_time:${sinceUnix}, query: ${fullQuery.slice(0,80)}`);
      const r = await fetch(fetchUrl, { headers: { "x-twitter-key": twitterKey } });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        console.warn(`[twitter] HTTP ${r.status}:`, errText.slice(0, 200));
        break;
      }
      const d = await r.json();
      if (d.error || d.errors) { console.warn("[twitter] API error:", d.error || JSON.stringify(d.errors)); break; }
      const tweets = Array.isArray(d.tweets) ? d.tweets : [];
      // Log first tweet shape once so we can verify field names
      if (page === 0 && tweets.length > 0) {
        const sample = tweets[0];
        console.log("[twitter] sample tweet keys:", Object.keys(sample));
        console.log("[twitter] sample author obj:", JSON.stringify(sample.author || sample.user || "none"));
      }
      pagesUsed++;
      // Cost = per-tweet charge, minimum per-call charge
      estimatedCost += Math.max(tweets.length * TWITTER_COST_PER_TWEET, TWITTER_COST_PER_CALL);

      let newTweets = 0;
      tweets.forEach(t => {
        const tweetId = t.id || String(Date.now() + Math.random());
        if (seenIds.has(tweetId)) return; // skip cursor-pagination duplicates
        seenIds.add(tweetId);
        newTweets++;
        const text = t.text || "";

        // TwitterAPI.io uses camelCase (userName) — also try snake_case and nested user obj.
        // Final fallback: extract handle from the tweet URL itself.
        const authorObj = t.author || t.user || {};
        const rawHandle =
          authorObj.userName    ||   // TwitterAPI.io primary
          authorObj.username    ||   // some endpoints use lowercase
          authorObj.screen_name ||   // legacy Twitter v1 naming
          authorObj.screenName  ||
          (() => {                   // extract from URL: x.com/HANDLE/status/ID
            const m = (t.url || "").match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,50})\/status\//);
            return m ? m[1] : null;
          })() ||
          "unknown";

        const followerCount =
          authorObj.followers       ||
          authorObj.followersCount  ||
          authorObj.followers_count ||
          0;

        const isVerified =
          authorObj.isVerified  ||
          authorObj.verified    ||
          authorObj.blueVerified ||
          false;

        const tweetUrl = t.url || `https://x.com/${rawHandle}/status/${tweetId}`;

        results.push({
          id: `tw-${company.id}-${tweetId}`,
          platform: "twitter",
          author: `@${rawHandle}`,
          text,
          url: tweetUrl,
          likes: t.likeCount || t.like_count || t.favorite_count || 0,
          comments: t.replyCount || t.reply_count || 0,
          retweets: t.retweetCount || t.retweet_count || 0,
          views: t.viewCount || t.view_count || t.impressionCount || 0,
          date: t.createdAt ? t.createdAt.slice(0, 10) : (t.created_at ? t.created_at.slice(0, 10) : ""),
          sentiment: quickSentiment("", text),
          isVerified,
          followerCount,
          isLive: true,
          source: "TwitterAPI.io",
        });
      });

      // Stop if no new unique tweets (cursor loop detected) or no more pages
      if (newTweets === 0 || !d.has_next_page || !d.next_cursor) break;
      cursor = d.next_cursor;
    } catch (e) {
      console.warn("[twitter] Fetch error:", e.message);
      break;
    }
  }

  // De-dupe by id
  const seen = new Set();
  const unique = results.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  console.log(`[twitter] ${company.name}: ${unique.length} tweets, ${pagesUsed} pages, ~$${estimatedCost.toFixed(4)}`);
  return { results: unique, pagesUsed, estimatedCost };
}

// ── Data365 Reddit fallback ───────────────────────────────────────────────────

export async function fetchData365(query, data365Key) {
  try {
    const r = await fetch(
      `http://localhost:3001/data365/v1.1/reddit/search/posts?query=${encodeURIComponent(query)}&limit=20&order_by=relevance&api_key=${data365Key}`
    );
    const d = await r.json();
    return (d.data?.items || []).map((p, i) => ({
      id: `d365-${i}`,
      platform: "reddit",
      author: `u/${p.author || "anon"}`,
      text: p.selftext || p.title || "",
      url: `https://reddit.com${p.permalink || ""}`,
      likes: p.score || 0, comments: p.num_comments || 0,
      date: p.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : "",
      sentiment: quickSentiment(p.title || "", p.selftext || ""),
      isLive: true, source: "Data365",
      subreddit: `r/${p.subreddit || ""}`,
    }));
  } catch { return []; }
}

// ── Main company run ──────────────────────────────────────────────────────────

export async function runCompany(company, settings, onProgress) {
  const { apiKeys, features, dateRange, twitterSpend } = settings;
  const range = DATE_RANGES.find(r => r.id === dateRange) || DATE_RANGES[2];
  const fromDate = dateRangeFrom(range.days);
  const query = company.boolean_query || `"${company.name}"`;

  const newsEnabled   = features.newsEnabled !== false;   // default on
  const twitterEnabled = !!(features.twitterEnabled && apiKeys.twitter);

  let mediaResults = [];
  let socialResults = [];
  let twitterCost = 0;

  // 1 ── News (NewsAPI)
  if (newsEnabled && apiKeys.newsapi) {
    onProgress("Fetching news…");
    try {
      mediaResults = await fetchNews(company, fromDate, apiKeys.newsapi, settings.outlets || []);
      console.log(`[run] ${company.name} news: ${mediaResults.length} articles`);
    } catch (e) { console.warn("[run] News failed:", e.message); }
  }

  // 2 ── Twitter (TwitterAPI.io) — primary social source
  if (twitterEnabled) {
    onProgress("Fetching Twitter/X mentions…");
    try {
      const monthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      const spentThisMonth = (twitterSpend || {})[monthKey] || 0;
      const budgetMonthly = features.twitterBudgetMonthly || 10;
      const budgetRemaining = Math.max(0, budgetMonthly - spentThisMonth);
      const maxPages = features.twitterMaxPages || 3;

      const { results, estimatedCost } = await fetchTwitter(
        company, fromDate, apiKeys.twitter, maxPages, budgetRemaining
      );
      socialResults = results;
      twitterCost = estimatedCost;
      console.log(`[run] ${company.name} twitter: ${results.length} tweets, ~$${estimatedCost.toFixed(4)}`);
    } catch (e) { console.warn("[run] Twitter failed:", e.message); }
  }

  // 3 ── Legacy social fallbacks (Yutori/Data365) when Twitter not configured
  if (!twitterEnabled) {
    if (features.social !== false && apiKeys.yutori) {
      onProgress("Fetching Yutori Scout…");
      try {
        const scout = await yutoriScout(company, apiKeys.yutori);
        socialResults = [...scout];
        if (features.yutoriResearch) {
          onProgress("Running deep search (Yutori Research)…");
          const { social, media } = await yutoriResearch(company, dateRange, apiKeys.yutori, onProgress);
          const socialUrls = new Set(socialResults.map(s => s.url));
          socialResults = [...socialResults, ...social.filter(s => !socialUrls.has(s.url))];
          const mediaUrls = new Set(mediaResults.map(m => m.url));
          mediaResults = [...mediaResults, ...media.filter(m => !mediaUrls.has(m.url))];
        }
      } catch (e) { console.warn("[run] Yutori failed:", e.message); }
    } else if (features.social !== false && apiKeys.data365) {
      onProgress("Fetching Reddit (Data365)…");
      try {
        socialResults = await fetchData365(query, apiKeys.data365);
      } catch (e) { console.warn("[run] Data365 failed:", e.message); }
    }
  }

  // 3 ── Sentiment analysis
  let sentimentScore = 0;
  let keyDrivers = [];
  let businessSignals = [];

  // Keyword baseline
  const allItems = [...mediaResults, ...socialResults];
  if (allItems.length > 0) {
    sentimentScore = allItems.reduce((s, i) => s + (i.sentiment || 0), 0) / allItems.length;
  }

  // LLM refinement if configured
  const hasLLM = apiKeys.vertex_enabled !== false || apiKeys.gemini || apiKeys.anthropic
               || apiKeys.cohere_north_key || apiKeys.cohere;

  if (features.sentiment && hasLLM && allItems.length > 0) {
    onProgress("Analysing sentiment with AI…");
    const topText = [
      ...mediaResults.slice(0, 10).map(m => `[News] ${m.title}: ${m.snippet}`),
      ...socialResults.slice(0, 10).map(s => `[${s.platform}] ${s.text}`),
    ].join("\n").slice(0, 3000);

    try {
      const raw = await callLLM(
        `Company: ${company.name} (${(company.categories || []).join(", ")})\n\nRecent coverage:\n${topText}\n\nReturn JSON only:`,
        `You are a VC portfolio analyst. Analyse coverage sentiment and return ONLY valid JSON:
{"score":<float -1.0 to +1.0>,"label":"Positive|Neutral|Negative|Very Positive|Very Negative","key_drivers":["driver1","driver2","driver3"],"business_signals":[{"type":"Hiring|Funding|Product|Partnership|Risk","summary":"one sentence"}]}`,
        apiKeys
      );
      const parsed = parseJSON(raw);
      if (parsed?.score !== undefined) {
        sentimentScore = parsed.score;
        keyDrivers = parsed.key_drivers || [];
        businessSignals = parsed.business_signals || [];
      }
    } catch (e) { console.warn("[run] LLM sentiment failed:", e.message); }
  }

  // 4 ── Sort & trim
  mediaResults.sort((a, b) => {
    if (a.tier !== b.tier) return (a.tier || 3) - (b.tier || 3);
    return (b.date || "").localeCompare(a.date || "");
  });
  // English language detection — filters out CJK, Arabic, Cyrillic etc
  const isEnglishText = (text) => {
    if (!text || text.length < 10) return true;
    const ascii = (text.match(/[\x20-\x7E]/g) || []).length;
    if (ascii / text.length < 0.6) return false;
    if (/[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text)) return false;
    return true;
  };

  // Engagement value score — weighted by signal strength
  // Retweets > replies > likes > views; verified/high-follower authors get a boost
  const engagementScore = s => {
    const base =
      (s.likes    || 0) * 1 +
      (s.retweets || 0) * 3 +   // retweets = strongest endorsement signal
      (s.comments || 0) * 2 +   // replies indicate real discussion
      (s.views    || 0) * 0.005; // views at low weight (high raw numbers)
    // Logarithmic follower boost — 100k followers = +32, 1M = +48, 10M = +64
    const followers = s.followerCount || 0;
    const followerBoost = followers > 0 ? Math.log10(Math.max(followers, 10)) * 16 : 0;
    const verifiedBoost = s.isVerified ? 60 : 0;  // verified accounts get stronger boost
    // Extra boost for very influential accounts (100k+ followers)
    const influencerBoost = followers >= 100000 ? 30 : followers >= 10000 ? 15 : 0;
    return base + followerBoost + verifiedBoost + influencerBoost;
  };
  // Filter to English-only posts
  const beforeEnglishFilter = socialResults.length;
  socialResults = socialResults.filter(s => isEnglishText(s.text));
  if (beforeEnglishFilter !== socialResults.length)
    console.log(`[social] English filter: ${beforeEnglishFilter} → ${socialResults.length} posts`);

  socialResults.sort((a, b) => engagementScore(b) - engagementScore(a));
  // Stamp the score onto each result for display
  socialResults = socialResults.map(s => ({ ...s, engagementScore: Math.round(engagementScore(s)) }));

  return {
    ranAt: new Date().toISOString(),
    dateRangeId: dateRange,
    fromDate, query,
    mediaResults: mediaResults.slice(0, 500).map(m => ({ ...m, snippet: (m.snippet || "").slice(0, 300) })),
    socialResults: socialResults.slice(0, 500).map(s => ({ ...s, text: (s.text || "").slice(0, 400) })),
    mediaCount: mediaResults.length,
    socialCount: socialResults.length,
    sentimentScore,
    keyDrivers,
    businessSignals,
    twitterCost,
    isLive: mediaResults.length > 0 || socialResults.length > 0,
  };
}

// ── Share of Voice run ────────────────────────────────────────────────────────

export async function runSOV(company, competitors, settings, onProgress) {
  const { apiKeys, features, dateRange } = settings;
  const range = DATE_RANGES.find(r => r.id === dateRange) || DATE_RANGES[2];
  const fromDate = dateRangeFrom(range.days);

  const subjects = [
    { name: company.name, isBase: true },
    ...competitors.map(c => ({ name: c.name, isBase: false })),
  ];

  const results = [];

  for (const subject of subjects) {
    onProgress(`Analysing ${subject.name}…`);
    let mediaCount = 0, socialCount = 0, sentiment = 0;
    let topArticles = []; // top 5 headlines for snapshot display

    if (apiKeys.newsapi) {
      try {
        const q = BOOLEAN_QUERIES[subject.name] || `"${subject.name}"`;
        const r = await fetch(
          `http://localhost:3001/newsapi/v2/everything?q=${encodeURIComponent(q)}&from=${fromDate}&sortBy=relevancy&pageSize=100&page=1&language=en&apiKey=${apiKeys.newsapi}`
        );
        const d = await r.json();
        const arts = (d.articles || []).filter(a => a.title && a.title !== "[Removed]");
        mediaCount = d.totalResults ? Math.min(d.totalResults, 300) : arts.length;
        if (arts.length > 0) {
          const scores = arts.slice(0, 20).map(a => quickSentiment(a.title || "", a.description || ""));
          sentiment = scores.reduce((s, v) => s + v, 0) / scores.length;
          // Store top 5 articles for snapshot display
          topArticles = arts.slice(0, 5).map(a => ({
            title: a.title || "",
            source: a.source?.name || "",
            url: a.url || "",
            date: (a.publishedAt || "").slice(0, 10),
            sentiment: quickSentiment(a.title || "", a.description || ""),
          }));
        }
      } catch {}
    }

    if (apiKeys.yutori && features.yutoriResearch) {
      try {
        const r = await fetch("http://localhost:3001/yutori/v1/research/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKeys.yutori },
          body: JSON.stringify({
            query: `Find social media mentions of "${subject.name}" on Twitter/X, Reddit, LinkedIn, and Hacker News in the past ${range.days} days.`,
          }),
        });
        const d = await r.json();
        if (d.task_id) {
          for (let i = 0; i < 15; i++) {
            await new Promise(res => setTimeout(res, 4000));
            const poll = await fetch(`http://localhost:3001/yutori/v1/research/tasks/${d.task_id}`, {
              headers: { "X-API-Key": apiKeys.yutori },
            });
            const pd = await poll.json();
            if (pd.status === "succeeded") {
              socialCount = (pd.citations || []).length;
              break;
            }
            if (["failed", "cancelled"].includes(pd.status)) break;
          }
        }
      } catch {}
    }

    results.push({ name: subject.name, isBase: subject.isBase, mediaCount, socialCount, sentiment, topArticles });
  }

  return { ranAt: new Date().toISOString(), dateRangeId: dateRange, results };
}

// ── AI Briefing ───────────────────────────────────────────────────────────────

// ── Theme detection ───────────────────────────────────────────────────────────

export const THEMES = [
  { id:"fundraise",   label:"Fundraise / Funding",    terms:["raises","raised","funding","series a","series b","series c","seed round","investment round","backed","valuation","venture","capital raise","ipo","spac"] },
  { id:"partnership", label:"Partnership / Deal",      terms:["partnership","partner","partners","deal","agreement","collaboration","collaborates","integrates","integration","signed","alliance","joint venture","signed agreement"] },
  { id:"product",     label:"Product / Launch",        terms:["launches","launched","launch","announces","announcement","announced","product","platform","releases","release","introduces","unveils","unveiled","new feature","beta","generally available","ga "] },
  { id:"revenue",     label:"Revenue / Growth",        terms:["revenue","arr","mrr","growth","profit","customers","milestone","record","sales","surpass","exceeds","beats","breakeven","profitable"] },
  { id:"hiring",      label:"Hiring / Leadership",     terms:["hire","hires","hired","hiring","appoints","appointed","joins","joined","names","named","ceo","cto","cpo","cfo","executive","leadership team","vp of","head of"] },
  { id:"acquisition", label:"Acquisition / M&A",       terms:["acquires","acquired","acquisition","merger","buys","bought","takeover","strategic acquisition"] },
  { id:"recognition", label:"Recognition / Award",     terms:["award","wins","winner","named","recognized","ranked","top 100","best","accolade","nominated","gartner","forrester"] },
  { id:"research",    label:"Research / Technology",   terms:["research","paper","arxiv","model","algorithm","benchmark","state of the art","breakthrough","patent","whitepaper","study","journal"] },
  { id:"risk",        label:"Risk / Controversy",      terms:["lawsuit","investigation","controversy","backlash","criticism","breach","hack","hacked","fraud","warning","recall","ban","blocked","regulatory","scrutiny","concern","problem","trouble","failure","fired","layoff","layoffs"] },
];

export function detectThemes(articles) {
  const buckets = {};
  THEMES.forEach(t => { buckets[t.id] = []; });

  articles.forEach(a => {
    const text = `${a.title || ""} ${a.snippet || ""}`.toLowerCase();
    THEMES.forEach(t => {
      if (t.terms.some(term => text.includes(term))) {
        buckets[t.id].push(a);
      }
    });
  });

  // Return only themes with at least one article, sorted by count desc
  return THEMES
    .filter(t => buckets[t.id].length > 0)
    .map(t => ({ ...t, articles: buckets[t.id] }))
    .sort((a, b) => b.articles.length - a.articles.length);
}

function formatThemes(themes, maxPerTheme = 3) {
  if (!themes.length) return "No clear themes detected in coverage.";
  return themes.map(t => {
    const examples = t.articles.slice(0, maxPerTheme)
      .map(a => `    - [${a.date?.slice(0,10)||""}] ${a.source} (T${a.tier}): ${a.title}`).join("\n");
    return `  ${t.label} (${t.articles.length} article${t.articles.length>1?"s":""})\n${examples}`;
  }).join("\n\n");
}

export async function generateBriefing(company, persona, apiKeys) {
  const run = company.runs?.[0];
  if (!run) throw new Error("No run data — run a search first");

  const mediaResults = run.mediaResults || [];
  const socialResults = run.socialResults || [];
  const sentiment = run.sentimentScore?.toFixed(2) || "0";
  const drivers = (run.keyDrivers || []).join(", ") || "none";
  const signals = (run.businessSignals || []).map(s => `• ${s.type}: ${s.summary}`).join("\n") || "None";

  // Theme clusters — used by all personas
  const themes = detectThemes(mediaResults);
  const themeBlock = formatThemes(themes);

  // Standard briefing data (exec / tech / comms)
  const topMedia = mediaResults.slice(0, 10)
    .map(m => `• [${m.date?.slice(0,10)||""}] ${m.source} (T${m.tier}): ${m.title}`).join("\n");
  const topSocial = socialResults.slice(0, 8)
    .map(s => `• [${s.platform}] ${s.text?.slice(0,200) || ""}`).join("\n");

  const sov = company.sovRun;
  const sovContext = (() => {
    if (!sov?.results?.length) return null;
    const totalMedia  = sov.results.reduce((s, r) => s + (r.mediaCount  || 0), 0);
    const totalSocial = sov.results.reduce((s, r) => s + (r.socialCount || 0), 0);
    const sorted = [...sov.results].sort((a, b) => (b.mediaCount || 0) - (a.mediaCount || 0));
    const rank = sorted.findIndex(r => r.isBase) + 1;
    let ctx = `Share of Voice data (collected ${sov.ranAt?.slice(0,10) || "unknown"}, ${sov.results.length} companies tracked):\n`;
    ctx += sorted.map(r => {
      const pressPct  = totalMedia  > 0 ? Math.round((r.mediaCount  || 0) / totalMedia  * 100) : 0;
      const socialPct = totalSocial > 0 ? Math.round((r.socialCount || 0) / totalSocial * 100) : 0;
      const marker = r.isBase ? "★ " : "  ";
      let line = `${marker}${r.name}: ${r.mediaCount || 0} press articles (${pressPct}% SOV)`;
      if (totalSocial > 0) line += `, ${r.socialCount || 0} social posts (${socialPct}% SOV)`;
      line += `, sentiment ${(r.sentiment || 0).toFixed(2)}`;
      return line;
    }).join("\n");
    ctx += `\n${company.name} ranks #${rank} by press coverage out of ${sov.results.length} companies tracked.`;
    if (sov.aiSummary) ctx += `\n\nAI competitive analysis:\n${sov.aiSummary}`;
    // Include top headlines per company
    const withArticles = sorted.filter(r => r.topArticles?.length);
    if (withArticles.length) {
      ctx += "\n\nRecent top headlines by company:";
      withArticles.forEach(r => {
        ctx += `\n  ${r.name}:\n`;
        r.topArticles.slice(0, 3).forEach(a => {
          ctx += `    - [${a.date}] ${a.source}: ${a.title}\n`;
        });
      });
    }
    return ctx;
  })();

  // ── Rich data packet for portfolio company report ─────────────────────────
  let reportPrompt = null;
  if (persona === "report") {
    const dateRange = run.ranAt
      ? `Data collected: ${run.ranAt.slice(0, 10)}`
      : "";

    // Sentiment breakdown: positive vs negative article counts
    const posArticles = mediaResults.filter(m => (m.sentiment || 0) > 0.1);
    const negArticles = mediaResults.filter(m => (m.sentiment || 0) < -0.1);
    const neutArticles = mediaResults.filter(m => Math.abs(m.sentiment || 0) <= 0.1);
    const sentLabel = parseFloat(sentiment) > 0.2 ? "Positive" : parseFloat(sentiment) < -0.2 ? "Negative" : "Neutral";

    // Tier breakdown
    const t1 = mediaResults.filter(m => m.tier === 1);
    const t2 = mediaResults.filter(m => m.tier === 2);
    const t3 = mediaResults.filter(m => m.tier === 3);

    // Top positive articles (most significant coverage)
    const topPos = [...mediaResults].sort((a, b) => (b.sentiment || 0) - (a.sentiment || 0)).slice(0, 6)
      .map(m => `  • [${m.date?.slice(0,10) || ""}] ${m.source} (T${m.tier}): ${m.title}${m.snippet ? " — " + m.snippet.slice(0, 120) : ""}`).join("\n");

    // Top negative articles
    const topNeg = [...mediaResults].sort((a, b) => (a.sentiment || 0) - (b.sentiment || 0)).slice(0, 4)
      .map(m => `  • [${m.date?.slice(0,10) || ""}] ${m.source} (T${m.tier}): ${m.title}${m.snippet ? " — " + m.snippet.slice(0, 100) : ""}`).join("\n");

    // Notable Tier 1 coverage
    const t1Coverage = t1.slice(0, 15).map(m => `  • ${m.source}: ${m.title}`).join("\n") + (t1.length > 15 ? `\n  ... and ${t1.length - 15} more T1 articles` : "");

    // Social breakdown by platform
    const byPlatform = {};
    socialResults.forEach(s => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; });
    const socialBreakdown = Object.entries(byPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");

    // Most influential handles (sorted by follower count)
    const topHandles = [...socialResults]
      .filter(s => s.followerCount > 1000)
      .sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0))
      .slice(0, 10);
    const influentialHandles = topHandles.length > 0
      ? topHandles.map(s => `  • @${s.author} (${s.platform}, ${fmt(s.followerCount || 0)} followers${s.isVerified ? ", verified" : ""}): "${s.text?.slice(0, 120) || ""}"`).join("\n")
      : "  None with significant following";

    // Top social posts by engagement score
    const topSocialFull = socialResults.slice(0, 10)
      .map(s => `  • [${s.platform}] @${s.author || "unknown"}${s.followerCount > 10000 ? ` (${fmt(s.followerCount)} followers)` : ""}: ${s.text?.slice(0, 200) || ""}${s.likes ? ` — ♥${fmt(s.likes)}` : ""}${s.retweets ? ` ↺${fmt(s.retweets)}` : ""}`).join("\n");

    // Competitive context — now uses enriched sovContext with %, rank, headlines, AI summary
    const compSection = sovContext
      ? `\nCOMPETITIVE SHARE OF VOICE:\n${sovContext}`
      : "\nCOMPETITIVE DATA: Not available — run Share of Voice tab for competitive context.";

    reportPrompt = `You are a senior communications analyst at Radical Ventures writing a high-level intelligence brief about ${company.name} for the leadership team.

Your task: synthesise the data below into a clear, narrative-driven brief focused on IMPACT, SENTIMENT and NARRATIVE. Be direct. Be opinionated. Reference specific outlets and headlines as evidence. Do not describe methodology or list raw numbers unless they tell a story.

Use this exact structure:

MEDIA & INTELLIGENCE BRIEF — ${company.name}
Prepared by Radical Ventures | ${new Date().toLocaleDateString("en-US", {month:"long", year:"numeric"})}
${dateRange}

─────────────────────────────────────────

EXECUTIVE SUMMARY (2-3 sentences)
A sharp top-line read: what is the dominant narrative right now, what is the overall sentiment, and what is the single most important thing leadership should know? Write this as if you are briefing a CEO.

─────────────────────────────────────────

1. NARRATIVE & IMPACT
What story is the media telling about ${company.name} right now? Describe the dominant narrative arc — is it a launch, a controversy, a milestone, a competitive battle? Name the outlets and headlines that are shaping the narrative. What is the real-world impact of this coverage?

2. SENTIMENT DEEP DIVE
Go beyond the score. What specifically is driving positive sentiment — which outlets, which angles, which quotes or themes? What, if anything, is creating negative or cautionary coverage? If sentiment is neutral, explain what is keeping it there.

3. TOP HEADLINES & SNIPPETS
List the 8-10 most significant articles with a one-line editorial note on why each matters. Format:
  • [Outlet, Date] "Headline" — why it matters

4. SOCIAL & COMMUNITY PULSE
What are people saying online? Focus on the most influential voices (highest follower counts, verified accounts). What themes are emerging in organic discussion? Is the tone aligned with or diverging from press sentiment?

5. SIGNALS & WATCH ITEMS
What patterns or signals in this data should leadership monitor closely? Are there emerging risks, missed opportunities, or narratives that need to be actively managed?

6. RECOMMENDED ACTIONS
Three to five specific, prioritised actions. Be concrete — name the outlet, the narrative, the timing.

─────────────────────────────────────────

---
DATA:

COVERAGE METRICS:
- Total articles: ${mediaResults.length >= 500 ? "500+ (volume cap reached — actual coverage may be higher)" : (run.mediaCount || mediaResults.length)}
- Social posts: ${socialResults.length >= 500 ? "500+ (volume cap reached — actual engagement may be higher)" : (run.socialCount || socialResults.length)}
- Overall sentiment score: ${sentiment} (${sentLabel})
- Tier 1 outlets: ${t1.length} articles | Tier 2: ${t2.length} | Tier 3: ${t3.length}
- Sentiment breakdown: ${posArticles.length} positive, ${neutArticles.length} neutral, ${negArticles.length} negative articles
${mediaResults.length >= 500 ? "- NOTE: Article count hit the 500-article cap. Total real-world coverage volume is higher than reported." : ""}${socialResults.length >= 500 ? "- NOTE: Social post count hit the 500-post cap. Total real-world social engagement is higher than reported." : ""}

COVERAGE THEMES (auto-detected, articles grouped by topic):
${formatThemes(themes, 4)}

KEY SENTIMENT DRIVERS (keywords): ${drivers}

BUSINESS SIGNALS:
${signals}

TIER 1 OUTLET COVERAGE:
${t1Coverage || "  None captured in this run"}

MOST POSITIVE COVERAGE:
${topPos || "  None"}

MOST CRITICAL / NEGATIVE COVERAGE:
${topNeg || "  None"}

SOCIAL MEDIA BREAKDOWN:
Platforms: ${socialBreakdown || "None"}

Most influential handles discussing this company:
${influentialHandles}

Top posts by engagement:
${topSocialFull || "  None"}
${compSection}

Now write the full report. Be analytical, specific, and reference the actual data above throughout.`;
  }

  const personas = {
    exec:  "You are briefing the CEO of Radical Ventures. Focus on strategic implications, competitive dynamics, and investment thesis validation. Be concise and actionable.",
    tech:  "You are briefing the technical partner at Radical Ventures. Focus on product developments, technical milestones, and competitive differentiation.",
    comms: "You are drafting a portfolio update for LPs. Be professional, highlight positive momentum, and flag any material risks. Use formal tone.",
  };

  const standardExtra = persona !== "report" && sovContext
    ? `\n\nCOMPETITIVE SHARE OF VOICE (include a brief competitive context section in your briefing):\n${sovContext}`
    : "";

  const userPrompt = reportPrompt ||
    `Company: ${company.name}\nSentiment: ${sentiment}\nKey drivers: ${drivers}\n\nCoverage themes (grouped by topic, ${themes.length} themes detected):\n${themeBlock}\n\nTop news:\n${topMedia}\n\nSocial:\n${topSocial}\n\nBusiness signals:\n${signals}${standardExtra}\n\nGenerate a structured briefing. In your KEY THEMES section, reference the coverage themes above and the specific stories that drove each.`;

  const systemPrompt = persona === "report"
    ? "You are a professional media analyst at a top-tier VC firm. Write detailed, analytical reports grounded strictly in the data provided. Use specific figures and article references throughout."
    : (personas[persona] || personas.exec);

  const raw = await callLLM(userPrompt, systemPrompt, apiKeys);
  return raw || "Unable to generate briefing — no LLM configured.";
}
