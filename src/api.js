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
    if (!a.url || seen.has(a.url) || a.title === "[Removed]") return false;
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
      if (!a.url || seen2.has(a.url) || a.title === "[Removed]") return false;
      seen2.add(a.url); return true;
    });
  }

  // Build tier lookup from outlets list
  const tierMap = {};
  outlets.forEach(o => {
    const k = (o.name || "").toLowerCase();
    tierMap[k] = o.tier || 2;
    tierMap[k.replace(/^the\s+/, "")] = o.tier || 2;
  });
  const getTier = name => {
    const k = (name || "").toLowerCase();
    return tierMap[k] || tierMap[k.replace(/^the\s+/, "")] || 2;
  };

  return articles
    .filter(a => !BLOCKED_DOMAINS.some(d => (a.url || "").toLowerCase().includes(d)))
    .filter(a => passesNotFilter(a, notPhrases))
    .slice(0, 100)
    .map((a, i) => {
      const src = a.source?.name || "Unknown";
      const title = a.title || "";
      const snippet = a.description || a.content?.slice(0, 200) || "";
      return {
        id: `n-${company.id}-${Date.now()}-${i}`,
        source: src,
        tier: getTier(src),
        title, snippet,
        url: a.url || "",
        date: (a.publishedAt || "").slice(0, 10),
        sentiment: quickSentiment(title, snippet),
        isLive: true,
      };
    });
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

export const TWITTER_COST_PER_TWEET = 0.00015; // $0.15 per 1000 tweets

// Convert our NewsAPI boolean query format to Twitter Advanced Search syntax.
// Key differences: NOT "phrase" → -"phrase", NOT word → -word
function booleanToTwitterQuery(query) {
  if (!query) return "";
  return query
    .replace(/\bNOT\s+"([^"]+)"/gi, (_, p) => `-"${p}"`)
    .replace(/\bNOT\s+([^\s")]+)/gi, (_, p) => `-${p}`)
    .trim();
}

export async function fetchTwitter(company, fromDate, twitterKey, maxPages = 3, budgetRemainingUSD = Infinity) {
  if (!twitterKey) return { results: [], pagesUsed: 0, estimatedCost: 0 };

  const baseQuery = booleanToTwitterQuery(company.boolean_query || `"${company.name}"`);
  // Twitter date filter in query string: since:YYYY-MM-DD
  const fullQuery = `${baseQuery} since:${fromDate} -is:retweet`;

  const results = [];
  let cursor = null;
  let pagesUsed = 0;
  let estimatedCost = 0;

  for (let page = 0; page < maxPages; page++) {
    // Stop if we'd exceed the budget
    if (estimatedCost + (20 * TWITTER_COST_PER_TWEET) > budgetRemainingUSD) {
      console.log(`[twitter] Budget cap reached at page ${page}`);
      break;
    }
    try {
      const params = new URLSearchParams({ query: fullQuery, queryType: "Latest" });
      if (cursor) params.set("cursor", cursor);

      const fetchUrl = `http://localhost:3001/twitter/twitter/tweet/advanced_search?${params}`;
      console.log(`[twitter] page ${page+1} → ${fetchUrl.split("?")[0]}, query: ${fullQuery.slice(0,80)}`);
      const r = await fetch(fetchUrl, { headers: { "x-twitter-key": twitterKey } });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        console.warn(`[twitter] HTTP ${r.status}:`, errText.slice(0, 200));
        break;
      }
      const d = await r.json();
      if (d.error || d.errors) { console.warn("[twitter] API error:", d.error || JSON.stringify(d.errors)); break; }
      const tweets = Array.isArray(d.tweets) ? d.tweets : [];
      pagesUsed++;
      estimatedCost += tweets.length * TWITTER_COST_PER_TWEET;

      tweets.forEach(t => {
        const text = t.text || "";
        results.push({
          id: `tw-${company.id}-${t.id || Date.now()}`,
          platform: "twitter",
          author: `@${t.author?.username || "unknown"}`,
          text,
          url: t.url || `https://x.com/i/web/status/${t.id}`,
          likes: t.likeCount || 0,
          comments: t.replyCount || 0,
          retweets: t.retweetCount || 0,
          views: t.viewCount || 0,
          date: t.createdAt ? t.createdAt.slice(0, 10) : "",
          sentiment: quickSentiment("", text),
          isVerified: t.author?.isVerified || false,
          followerCount: t.author?.followers || 0,
          isLive: true,
          source: "TwitterAPI.io",
        });
      });

      if (!d.has_next_page || !d.next_cursor || tweets.length === 0) break;
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
  // Engagement value score — weighted by signal strength
  // Retweets > replies > likes > views; verified/high-follower authors get a boost
  const engagementScore = s => {
    const base =
      (s.likes    || 0) * 1 +
      (s.retweets || 0) * 3 +   // retweets = strongest endorsement signal
      (s.comments || 0) * 2 +   // replies indicate real discussion
      (s.views    || 0) * 0.005; // views at low weight (high raw numbers)
    const followerBoost = Math.log10(Math.max(s.followerCount || 1, 10)) * 8;
    const verifiedBoost = s.isVerified ? 40 : 0;
    return base + followerBoost + verifiedBoost;
  };
  socialResults.sort((a, b) => engagementScore(b) - engagementScore(a));
  // Stamp the score onto each result for display
  socialResults = socialResults.map(s => ({ ...s, engagementScore: Math.round(engagementScore(s)) }));

  return {
    ranAt: new Date().toISOString(),
    dateRangeId: dateRange,
    fromDate, query,
    mediaResults: mediaResults.slice(0, 100).map(m => ({ ...m, snippet: (m.snippet || "").slice(0, 300) })),
    socialResults: socialResults.slice(0, 100).map(s => ({ ...s, text: (s.text || "").slice(0, 400) })),
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

    if (apiKeys.newsapi) {
      try {
        const q = BOOLEAN_QUERIES[subject.name] || `"${subject.name}"`;
        const r = await fetch(
          `http://localhost:3001/newsapi/v2/everything?q=${encodeURIComponent(q)}&from=${fromDate}&sortBy=relevancy&pageSize=100&page=1&language=en&apiKey=${apiKeys.newsapi}`
        );
        const d = await r.json();
        const arts = d.articles || [];
        mediaCount = d.totalResults ? Math.min(d.totalResults, 300) : arts.length;
        if (arts.length > 0) {
          const scores = arts.slice(0, 20).map(a => quickSentiment(a.title || "", a.description || ""));
          sentiment = scores.reduce((s, v) => s + v, 0) / scores.length;
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

    results.push({ name: subject.name, isBase: subject.isBase, mediaCount, socialCount, sentiment });
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
  const sovContext = sov?.results?.length
    ? sov.results.map(r => `  ${r.isBase ? "★ " : "  "}${r.name}: ${r.mediaCount || 0} articles, sentiment ${(r.sentiment || 0).toFixed(2)}`).join("\n")
    : null;

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
    const t1Coverage = t1.slice(0, 8).map(m => `  • ${m.source}: ${m.title}`).join("\n");

    // Social breakdown by platform
    const byPlatform = {};
    socialResults.forEach(s => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; });
    const socialBreakdown = Object.entries(byPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");

    // Top social posts
    const topSocialFull = socialResults.slice(0, 8)
      .map(s => `  • [${s.platform}] ${s.text?.slice(0, 200) || ""}${s.likes ? ` (${s.likes} likes)` : ""}`).join("\n");

    // Competitive context
    const compSection = sovContext
      ? `\nCOMPETITIVE SHARE OF VOICE (last SOV run: ${sov.ranAt?.slice(0,10) || "unknown"}):\n${sovContext}\n\nRelative position: ${company.name} had ${sov.results.find(r=>r.isBase)?.mediaCount || 0} articles vs peers above.`
      : "\nCOMPETITIVE DATA: Not available — run Share of Voice for competitive context.";

    reportPrompt = `You are writing a media and public coverage report FROM Radical Ventures TO the ${company.name} leadership team.

Write a thorough, data-driven report using ALL of the data below. Do not make claims that are not supported by the data. If data is thin, say so honestly.

Use this exact structure:

MEDIA & COVERAGE REPORT — ${company.name}
Prepared by Radical Ventures | ${new Date().toLocaleDateString("en-US", {month:"long", year:"numeric"})}
${dateRange}

1. COVERAGE OVERVIEW
   Total volume, tier breakdown, and types of outlets. Note the dominant coverage themes.

2. COVERAGE THEMES & KEY STORIES
   For each theme that generated meaningful coverage, describe what drove it and name the most significant articles. Be specific — reference outlets and headlines.

3. SENTIMENT ANALYSIS
   Analyse the overall sentiment score. What drove positive coverage? What drove negative? Reference specific articles for both.

4. SOCIAL MEDIA PRESENCE
   Platforms, volume, tone. Reference specific posts where relevant.

5. COMPETITIVE CONTEXT
   Compare coverage volume and sentiment to peers. Highlight ${company.name}'s relative position.

6. COMMUNICATIONS RECOMMENDATIONS
   Specific, actionable advice based on the coverage patterns above. Address any gaps or risks.

---
DATA:

COVERAGE METRICS:
- Total articles: ${run.mediaCount || mediaResults.length}
- Social posts: ${run.socialCount || socialResults.length}
- Overall sentiment score: ${sentiment} (${sentLabel})
- Tier 1 outlets: ${t1.length} articles | Tier 2: ${t2.length} | Tier 3: ${t3.length}
- Sentiment breakdown: ${posArticles.length} positive, ${neutArticles.length} neutral, ${negArticles.length} negative articles

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
Top posts:
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
    ? `\n\nCompetitive share of voice:\n${sovContext}`
    : "";

  const userPrompt = reportPrompt ||
    `Company: ${company.name}\nSentiment: ${sentiment}\nKey drivers: ${drivers}\n\nCoverage themes (grouped by topic, ${themes.length} themes detected):\n${themeBlock}\n\nTop news:\n${topMedia}\n\nSocial:\n${topSocial}\n\nBusiness signals:\n${signals}${standardExtra}\n\nGenerate a structured briefing. In your KEY THEMES section, reference the coverage themes above and the specific stories that drove each.`;

  const systemPrompt = persona === "report"
    ? "You are a professional media analyst at a top-tier VC firm. Write detailed, analytical reports grounded strictly in the data provided. Use specific figures and article references throughout."
    : (personas[persona] || personas.exec);

  const raw = await callLLM(userPrompt, systemPrompt, apiKeys);
  return raw || "Unable to generate briefing — no LLM configured.";
}
