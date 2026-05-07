import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { buildInitialCompanies, DEFAULT_OUTLETS, DATE_RANGES, BOOLEAN_QUERIES } from "./data.js";
import { runCompany, runSOV, generateBriefing, quickSentiment, callLLM, parseJSON, detectThemes, bustCompanyCache } from "./api.js";

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "radical_v5";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge any new companies from RAW_PORTFOLIO that aren't in saved state
      const canonical = buildInitialCompanies();
      const canonicalMap = Object.fromEntries(canonical.map(c => [c.id, c]));
      const savedIds = new Set(saved.companies.map(c => c.id));
      const newEntries = canonical.filter(c => !savedIds.has(c.id));
      if (newEntries.length > 0) {
        saved.companies = [...saved.companies, ...newEntries];
      }
      // Patch fields from canonical that won't be in old saved state
      saved.companies = saved.companies.map(c => {
        const canon = canonicalMap[c.id];
        if (!canon) return c;
        const patches = {};
        if (canon.isFirm && !c.isFirm) patches.isFirm = true;
        if (canon.twitter_handle !== undefined && c.twitter_handle === undefined) patches.twitter_handle = canon.twitter_handle;
        if (canon.twitter_accounts !== undefined && c.twitter_accounts === undefined) patches.twitter_accounts = canon.twitter_accounts;
        // Merge competitors: add any new canon entries, but preserve user-added ones
        if (canon.competitors?.length) {
          const savedComps = c.competitors || [];
          const savedNames = new Set(savedComps.map(x => x.name));
          const newFromCanon = canon.competitors.filter(x => !savedNames.has(x.name));
          if (newFromCanon.length > 0) {
            patches.competitors = [...savedComps, ...newFromCanon];
          }
        }
        return Object.keys(patches).length ? { ...c, ...patches } : c;
      });
      return migrateSettings(saved);
    }
  } catch {}
  // Migrate from old keys
  try {
    const old = localStorage.getItem("radical_companies");
    if (old) {
      const companies = JSON.parse(old).map(c => ({
        id: c.id, name: c.name, categories: c.categories || [],
        year: c.year, description: c.description, website: c.website,
        enabled: c.monitoring_enabled !== false,
        boolean_query: c.boolean_query || `"${c.name}"`,
        boolean_approved: c.boolean_approved || false,
        competitors: (c.competitors || []).map(cx => ({ id: cx.id || cx.name, name: cx.name, rationale: cx.rationale || "" })),
        runs: c.lastRun ? [{ ...c.lastRun, mediaCount: c.lastRun.mediaCount || (c.lastRun.mediaResults || []).length, socialCount: c.lastRun.socialCount || (c.lastRun.socialResults || []).length }] : [],
        sovRun: c.sovData || null,
      }));
      const apiKeys = {
        newsapi: localStorage.getItem("radical_apikey_newsapi") || "",
        yutori: localStorage.getItem("radical_apikey_yutori") || "",
        data365: localStorage.getItem("radical_apikey_data365") || "",
        gemini: localStorage.getItem("radical_apikey_gemini") || "",
        anthropic: localStorage.getItem("radical_anthropic_key") || "",
        cohere: localStorage.getItem("radical_apikey_cohere") || "",
        cohere_north_key: localStorage.getItem("radical_cohere_north_key") || "",
        cohere_north_hostname: localStorage.getItem("radical_cohere_north_hostname") || "radical.cloud.cohere.com",
        cohere_north_model: localStorage.getItem("radical_cohere_north_model") || "command-r-plus",
        vertex_enabled: localStorage.getItem("radical_vertex_enabled") !== "false",
      };
      return migrateSettings({ companies, outlets: DEFAULT_OUTLETS, settings: { apiKeys, features: { social: true, yutoriResearch: true, sentiment: true }, dateRange: "30d" } });
    }
  } catch {}
  return {
    companies: buildInitialCompanies(),
    outlets: DEFAULT_OUTLETS,
    settings: {
      apiKeys: { newsapi:"", twitter:"", yutori:"", data365:"", gemini:"", anthropic:"", cohere:"", cohere_north_key:"", cohere_north_hostname:"radical.cloud.cohere.com", cohere_north_model:"command-r-plus", vertex_enabled:true },
      features: { newsEnabled:true, twitterEnabled:false, twitterMaxPages:3, twitterBudgetMonthly:10, sentiment:true, social:true, yutoriResearch:true },
      twitterSpend: {},
      twitterCreditBalance: 20,
      twitterRunLog: [],
      dateRange: "30d",
    },
  };
}

function migrateSettings(state) {
  const s = state.settings || {};
  const f = { ...s.features };
  if (f.newsEnabled === undefined)         f.newsEnabled = true;
  if (f.twitterEnabled === undefined)      f.twitterEnabled = false;
  if (f.twitterMaxPages === undefined)     f.twitterMaxPages = 3;
  if (f.twitterBudgetMonthly === undefined) f.twitterBudgetMonthly = 10;
  if (f.sentiment === undefined)           f.sentiment = true;
  const apiKeys = { ...s.apiKeys };
  if (apiKeys.twitter === undefined) apiKeys.twitter = "";
  return { ...state, sandboxCompanies: state.sandboxCompanies || [], settings: { ...s, apiKeys, features: f, twitterSpend: s.twitterSpend || {}, twitterCreditBalance: s.twitterCreditBalance ?? 20, twitterRunLog: s.twitterRunLog || [] } };
}

function saveState(state) {
  try {
    const s = JSON.stringify(state);
    if (s.length > 4_500_000) {
      const trimmed = { ...state, companies: state.companies.map(c => ({ ...c, runs: c.runs.map((r, i) => i === 0 ? r : { ...r, mediaResults: [], socialResults: [] }) })) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(STORAGE_KEY, s);
  } catch (e) { console.error("[storage] save failed:", e.message); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = n => { if (!n && n !== 0) return "—"; const a = Math.abs(n); return a >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : a >= 1e6 ? `${(n/1e6).toFixed(1)}M` : a >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n); };
const sc  = s => s > 0.5 ? "#22c55e" : s > 0.15 ? "#4ade80" : s < -0.5 ? "#ef4444" : s < -0.15 ? "#f87171" : "#f59e0b";
const sl  = s => s > 0.5 ? "Very Positive" : s > 0.15 ? "Positive" : s < -0.5 ? "Very Negative" : s < -0.15 ? "Negative" : "Neutral";
const tc  = t => t === 1 ? "#fbbf24" : t === 2 ? "#818cf8" : "#6b7280";
const ago = d => { if (!d) return "never"; const dy = Math.floor((Date.now() - new Date(d)) / 86400000); return dy === 0 ? "today" : dy === 1 ? "yesterday" : dy < 7 ? `${dy}d ago` : dy < 30 ? `${Math.floor(dy/7)}w ago` : `${Math.floor(dy/30)}mo ago`; };

const CAT_COLOR = { LLMs:"#7c3aed", Software:"#3b82f6", Healthcare:"#10b981", Biotechnology:"#ec4899", Climate:"#06b6d4", Materials:"#f59e0b", Space:"#8b5cf6", Semiconductors:"#f97316", Data:"#14b8a6", Infrastructure:"#64748b", "Financial Services":"#22c55e", Robotics:"#e11d48", Search:"#0ea5e9", Construction:"#a3e635", Transportation:"#fb923c", Security:"#f43f5e" };

const PLAT = { twitter:{ color:"#1d9bf0", icon:"𝕏" }, reddit:{ color:"#ff4500", icon:"◉" }, linkedin:{ color:"#0a66c2", icon:"in" }, hackernews:{ color:"#ff6000", icon:"Y" }, web:{ color:"#818cf8", icon:"◈" } };

// Distinct colors for competitive SOV — index 0 is always the focal company (accent)
const SOV_PALETTE = ["#818cf8","#34d399","#f59e0b","#f87171","#60a5fa","#a78bfa","#4ade80","#fb923c","#38bdf8","#e879f9","#facc15","#2dd4bf"];

// ── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toasts, setToasts] = useState([]);
  const fire = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  const Toasts = () => (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==="error" ? "#ef4444" : t.type==="success" ? "#22c55e" : "#1e293b", color:"#fff", padding:"10px 16px", borderRadius:8, fontSize:13, fontWeight:600, boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
          {t.type==="error" ? "⚠ " : t.type==="success" ? "✓ " : "● "}{t.msg}
        </div>
      ))}
    </div>
  );
  return { fire, Toasts };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:    "#070711",
  card:  "rgba(255,255,255,0.04)",
  cardHover: "rgba(255,255,255,0.065)",
  border:"rgba(255,255,255,0.08)",
  borderHi:"rgba(255,255,255,0.14)",
  text:  "#f0f0f5",
  dim:   "rgba(255,255,255,0.4)",
  faint: "rgba(255,255,255,0.2)",
  ghost: "rgba(255,255,255,0.1)",
  accent:"#818cf8",
  accentDim:"rgba(129,140,248,0.15)",
};

const Btn = ({ children, onClick, variant="ghost", disabled, style={} }) => {
  const base = { display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:7, fontSize:12, fontWeight:600, cursor:disabled?"not-allowed":"pointer", border:"none", transition:"all 0.15s", opacity:disabled?0.45:1, ...style };
  const styles = {
    ghost:   { background:"transparent", color:T.dim, border:`1px solid ${T.border}` },
    primary: { background:"rgba(129,140,248,0.2)", color:T.accent, border:`1px solid rgba(129,140,248,0.35)` },
    danger:  { background:"rgba(239,68,68,0.12)", color:"#f87171", border:"1px solid rgba(239,68,68,0.25)" },
    success: { background:"rgba(34,197,94,0.12)", color:"#4ade80", border:"1px solid rgba(34,197,94,0.25)" },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...styles[variant] }}>{children}</button>;
};

const Input = ({ value, onChange, placeholder, style={}, onKeyDown }) => (
  <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} onKeyDown={onKeyDown}
    style={{ background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 11px", fontSize:12, color:T.text, outline:"none", width:"100%", fontFamily:"inherit", ...style }}
  />
);

const Tag = ({ label, color }) => (
  <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:10, background:`${color}20`, color, border:`1px solid ${color}40`, flexShrink:0 }}>{label}</span>
);

const Pip = ({ score, size=8 }) => (
  <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:sc(score), flexShrink:0 }} title={`${sl(score)} (${score.toFixed(2)})`} />
);

const SentimentChip = ({ score }) => (
  <span style={{ fontSize:11, fontWeight:700, color:sc(score), background:`${sc(score)}18`, padding:"3px 8px", borderRadius:6, border:`1px solid ${sc(score)}35` }}>
    {score > 0 ? "+" : ""}{score.toFixed(2)} {sl(score)}
  </span>
);

const Divider = () => <div style={{ height:1, background:T.border, margin:"16px 0" }} />;

const Spinner = () => (
  <div style={{ display:"inline-block", width:14, height:14, border:`2px solid ${T.ghost}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />
);

// ── Article Card ──────────────────────────────────────────────────────────────

function ArticleCard({ item }) {
  return (
    <a href={item.url || "#"} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none", display:"block" }}
      onMouseEnter={e => e.currentTarget.firstChild.style.borderColor = T.accent + "80"}
      onMouseLeave={e => e.currentTarget.firstChild.style.borderColor = T.border}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:6, transition:"border-color 0.15s", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:10, fontWeight:700, color:tc(item.tier), background:`${tc(item.tier)}18`, padding:"2px 6px", borderRadius:4, border:`1px solid ${tc(item.tier)}35` }}>T{item.tier}</span>
          <span style={{ fontSize:11, fontWeight:600, color:T.dim }}>{item.source}</span>
          <span style={{ fontSize:10, color:T.faint, marginLeft:"auto" }}>{item.date}</span>
          <Pip score={item.sentiment || 0} />
        </div>
        <div style={{ fontSize:13, fontWeight:600, color:T.text, lineHeight:1.4 }}>{item.title}</div>
        {item.snippet && <p style={{ fontSize:11, color:T.dim, margin:0, lineHeight:1.5 }}>{item.snippet.slice(0, 160)}{item.snippet.length > 160 ? "…" : ""}</p>}
      </div>
    </a>
  );
}

// ── Social Card ───────────────────────────────────────────────────────────────

function SocialCard({ item, highlight }) {
  const p = PLAT[item.platform] || PLAT.web;
  const hasEngagement = item.likes > 0 || item.retweets > 0 || item.comments > 0 || item.views > 0;
  const url = item.url || "#";
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none", display:"block" }}>
      <div style={{ background: highlight ? `${p.color}10` : T.card,
        border:`1px solid ${highlight ? p.color+"50" : T.border}`,
        borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:6,
        transition:"border-color 0.15s, box-shadow 0.15s", cursor:"pointer" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = p.color+"80"; e.currentTarget.style.boxShadow = `0 0 0 1px ${p.color}30`; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = highlight ? p.color+"50" : T.border; e.currentTarget.style.boxShadow = "none"; }}>
        {/* Header row */}
        <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, fontWeight:800, color:p.color, width:18, textAlign:"center", flexShrink:0 }}>{p.icon}</span>
          <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{item.author}</span>
          {item.isVerified && <span title="Verified account" style={{ fontSize:10, background:"#3b82f620", color:"#60a5fa", borderRadius:4, padding:"0 4px" }}>✓ Verified</span>}
          {item.followerCount > 1000 && <span style={{ fontSize:10, color:T.faint }}>{fmt(item.followerCount)} followers</span>}
          {item.subreddit && <span style={{ fontSize:10, color:T.faint }}>{item.subreddit}</span>}
          <span style={{ fontSize:10, color:T.faint, marginLeft:"auto" }}>{item.date}</span>
          <Pip score={item.sentiment || 0} />
        </div>
        {/* Post text */}
        <p style={{ fontSize:12, color:T.text, margin:0, lineHeight:1.6 }}>{(item.text || "").slice(0, 300)}{(item.text||"").length > 300 ? "…" : ""}</p>
        {/* Engagement row */}
        {hasEngagement && (
          <div style={{ display:"flex", gap:12, alignItems:"center", paddingTop:2, borderTop:`1px solid ${T.border}`, marginTop:2 }}>
            {item.likes    > 0 && <span style={{ fontSize:10, color:T.faint }}>♥ {fmt(item.likes)}</span>}
            {item.retweets > 0 && <span style={{ fontSize:10, color:T.faint }}>↺ {fmt(item.retweets)}</span>}
            {item.comments > 0 && <span style={{ fontSize:10, color:T.faint }}>💬 {fmt(item.comments)}</span>}
            {item.views    > 0 && <span style={{ fontSize:10, color:T.faint }}>👁 {fmt(item.views)}</span>}
            {item.engagementScore > 0 && (
              <span style={{ marginLeft:"auto", fontSize:10, fontWeight:700,
                color: item.engagementScore > 500 ? "#fbbf24" : item.engagementScore > 100 ? T.accent : T.faint }}
                title="Engagement score: likes + retweets×3 + replies×2 + views×0.005 + follower/verified boost">
                ⚡ {fmt(item.engagementScore)}
              </span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}

// ── Social Insights Panel ─────────────────────────────────────────────────────

const SOCIAL_THEMES = [
  { label:"Funding / Investment",    keywords:["fund","raise","invest","capital","series","round","million","billion","valuation","backed","vc"] },
  { label:"Product / Launch",        keywords:["launch","release","ship","new feature","announce","product","update","v2","beta","available"] },
  { label:"Research / Models",       keywords:["research","paper","model","benchmark","sota","llm","training","dataset","open-source","weights"] },
  { label:"Hiring / Team",           keywords:["hire","hiring","join","team","career","job","talent","we're growing","open role","position"] },
  { label:"Partnerships / Deals",    keywords:["partner","collaboration","integrat","deal","agreement","work with","join force","strategic"] },
  { label:"Industry Recognition",    keywords:["award","congrat","well deserved","leader","top company","best","ranked","named","recognized"] },
  { label:"Criticism / Risk",        keywords:["concern","risk","problem","fail","issue","lawsuit","regulat","critic","wrong","bad","dangerous","mislead"] },
  { label:"Customer / Use Case",     keywords:["customer","client","user","use case","success story","case study","deploy","production","enterprise"] },
];

function SocialInsights({ posts }) {
  const [expanded, setExpanded] = useState(true);
  if (!posts || posts.length < 3) return null;

  // Top engagement post
  const topEngagement = [...posts].sort((a, b) => (b.engagementScore||0) - (a.engagementScore||0))[0];

  // Largest audience (highest follower count)
  const byFollowers = [...posts].sort((a, b) => (b.followerCount||0) - (a.followerCount||0));
  const largestAudience = byFollowers[0]?.followerCount > 0 ? byFollowers[0] : null;

  // Notable handles — dedupe authors, rank by followers then engagement
  const authorMap = {};
  posts.forEach(p => {
    const key = p.author;
    if (!authorMap[key]) authorMap[key] = { author:key, followers:p.followerCount||0, isVerified:p.isVerified||false, postCount:0, totalEng:0, url:p.url };
    authorMap[key].postCount++;
    authorMap[key].totalEng += p.engagementScore || 0;
    if ((p.followerCount||0) > authorMap[key].followers) authorMap[key].followers = p.followerCount;
    if (p.isVerified) authorMap[key].isVerified = true;
  });
  const notableHandles = Object.values(authorMap)
    .filter(a => a.followers > 5000 || a.isVerified || a.postCount > 1)
    .sort((a, b) => (b.isVerified - a.isVerified) || (b.followers - a.followers) || (b.totalEng - a.totalEng))
    .slice(0, 10);

  // Theme detection
  const themeCounts = {};
  posts.forEach(p => {
    const text = (p.text || "").toLowerCase();
    SOCIAL_THEMES.forEach(({ label, keywords }) => {
      if (keywords.some(k => text.includes(k))) themeCounts[label] = (themeCounts[label]||0) + 1;
    });
  });
  const themes = Object.entries(themeCounts).sort((a,b) => b[1]-a[1]).slice(0, 6);
  const maxThemeCount = themes[0]?.[1] || 1;

  const MiniPostCard = ({ post, badge }) => {
    const pl = PLAT[post.platform] || PLAT.web;
    return (
      <a href={post.url||"#"} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
        <div style={{ background:"rgba(0,0,0,0.2)", border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 12px", cursor:"pointer", transition:"border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = pl.color+"60"}
          onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
            <span style={{ fontSize:10, padding:"1px 6px", borderRadius:10, background:`${pl.color}25`, color:pl.color, fontWeight:700, fontSize:10 }}>{badge}</span>
            <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{post.author}</span>
            {post.isVerified && <span style={{ fontSize:9, color:"#60a5fa" }}>✓</span>}
            {post.followerCount > 0 && <span style={{ fontSize:10, color:T.faint, marginLeft:"auto" }}>{fmt(post.followerCount)} followers</span>}
          </div>
          <p style={{ fontSize:11, color:T.dim, margin:0, lineHeight:1.5 }}>{(post.text||"").slice(0,160)}{(post.text||"").length>160?"…":""}</p>
          <div style={{ display:"flex", gap:10, marginTop:6 }}>
            {post.likes>0    && <span style={{ fontSize:10, color:T.faint }}>♥ {fmt(post.likes)}</span>}
            {post.retweets>0 && <span style={{ fontSize:10, color:T.faint }}>↺ {fmt(post.retweets)}</span>}
            {post.views>0    && <span style={{ fontSize:10, color:T.faint }}>👁 {fmt(post.views)}</span>}
            {post.engagementScore>0 && <span style={{ marginLeft:"auto", fontSize:10, fontWeight:700, color:"#fbbf24" }}>⚡ {fmt(post.engagementScore)}</span>}
          </div>
        </div>
      </a>
    );
  };

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, marginBottom:16, overflow:"hidden" }}>
      {/* Header */}
      <div onClick={() => setExpanded(e => !e)}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", cursor:"pointer", borderBottom: expanded ? `1px solid ${T.border}` : "none" }}>
        <div style={{ fontSize:12, fontWeight:700, color:T.text }}>
          📊 Social Intelligence
          <span style={{ fontSize:11, color:T.dim, fontWeight:400, marginLeft:8 }}>{posts.length} posts analysed</span>
        </div>
        <span style={{ fontSize:12, color:T.faint }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:16 }}>

          {/* Top posts row */}
          <div style={{ display:"grid", gridTemplateColumns: largestAudience && largestAudience.author !== topEngagement.author ? "1fr 1fr" : "1fr", gap:10 }}>
            <MiniPostCard post={topEngagement} badge="⚡ Top engagement" />
            {largestAudience && largestAudience.author !== topEngagement.author && (
              <MiniPostCard post={largestAudience} badge="👥 Largest audience" />
            )}
          </div>

          {/* Notable handles */}
          {notableHandles.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Notable handles engaged</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {notableHandles.map(a => (
                  <a key={a.author} href={`https://x.com/${a.author.replace(/^@/,"")}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20, background:"rgba(29,155,240,0.1)", border:"1px solid rgba(29,155,240,0.2)", cursor:"pointer" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(29,155,240,0.5)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(29,155,240,0.2)"}>
                      <span style={{ fontSize:11, fontWeight:700, color:"#1d9bf0" }}>{a.author}</span>
                      {a.isVerified && <span style={{ fontSize:9, color:"#60a5fa" }}>✓</span>}
                      {a.followers > 0 && <span style={{ fontSize:10, color:T.faint }}>{fmt(a.followers)}</span>}
                      {a.postCount > 1 && <span style={{ fontSize:10, color:T.dim }}>{a.postCount} posts</span>}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Theme breakdown */}
          {themes.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Conversation themes</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {themes.map(([label, count]) => (
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:11, color:T.text, width:180, flexShrink:0 }}>{label}</span>
                    <div style={{ flex:1, height:5, borderRadius:3, background:T.ghost, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(count/maxThemeCount)*100}%`, background:T.accent, borderRadius:3, transition:"width 0.4s" }} />
                    </div>
                    <span style={{ fontSize:11, color:T.dim, width:28, textAlign:"right", flexShrink:0 }}>{count}</span>
                    <span style={{ fontSize:10, color:T.faint, width:38, flexShrink:0 }}>{Math.round((count/posts.length)*100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Article Timeline ──────────────────────────────────────────────────────────

function ArticleTimeline({ articles, onDateClick, selectedDate }) {
  if (!articles?.length) return null;
  const counts = {};
  articles.forEach(a => { const d = a.date?.slice(0, 10); if (d) counts[d] = (counts[d] || 0) + 1; });
  const days = Object.keys(counts).sort().slice(-30);
  const max = Math.max(...days.map(d => counts[d]));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:36, cursor:"pointer" }}>
      {days.map(d => (
        <div key={d} onClick={() => onDateClick(selectedDate === d ? null : d)} title={`${d}: ${counts[d]} articles`}
          style={{ flex:1, minWidth:4, height:`${Math.max(15, (counts[d]/max)*100)}%`, borderRadius:3, background: selectedDate === d ? T.accent : "rgba(129,140,248,0.35)", transition:"all 0.15s" }} />
      ))}
    </div>
  );
}

// ── Portfolio Health Panel ────────────────────────────────────────────────────

function PortfolioHealth({ companies }) {
  const withData = companies.filter(c => c.enabled !== false && c.runs?.[0]?.sentimentScore !== undefined);
  if (withData.length === 0) return null;

  // ── Aggregate metrics ──────────────────────────────────────────────────────
  const avgSent   = withData.reduce((s, c) => s + c.runs[0].sentimentScore, 0) / withData.length;
  const totalArt  = withData.reduce((s, c) => s + (c.runs[0].mediaCount || 0), 0);
  const totalSoc  = withData.reduce((s, c) => s + (c.runs[0].socialCount || 0), 0);
  const sentPct   = Math.min(100, Math.max(0, (avgSent + 1) / 2 * 100));
  const sentColor = avgSent > 0.15 ? "#22c55e" : avgSent < -0.15 ? "#ef4444" : "#f59e0b";
  const sentLabel = avgSent > 0.15 ? "Positive" : avgSent < -0.15 ? "Negative" : "Neutral";

  // ── 90-day trend: collect all (date, sentiment) run data-points ────────────
  const cutoff = Date.now() - 90 * 86400_000;
  const points = [];
  companies.forEach(c => {
    (c.runs || []).forEach(r => {
      if (r.ranAt && r.sentimentScore !== undefined) {
        const t = new Date(r.ranAt).getTime();
        if (t >= cutoff) points.push({ t, s: r.sentimentScore });
      }
    });
  });
  points.sort((a, b) => a.t - b.t);

  // Bucket into ~12 weekly slots
  const trendPoints = (() => {
    if (points.length < 2) return [];
    const minT = points[0].t, maxT = points[points.length - 1].t;
    const range = Math.max(maxT - minT, 1);
    const buckets = 12;
    const slots = Array.from({ length: buckets }, () => []);
    points.forEach(p => {
      const idx = Math.min(buckets - 1, Math.floor(((p.t - minT) / range) * buckets));
      slots[idx].push(p.s);
    });
    return slots.map((b, i) => ({ i, v: b.length ? b.reduce((a, x) => a + x, 0) / b.length : null }))
      .filter(p => p.v !== null);
  })();

  // SVG trend line
  const TrendLine = () => {
    if (trendPoints.length < 2) return (
      <div style={{ fontSize:11, color:T.faint, textAlign:"center", paddingTop:20 }}>
        Run more companies to build trend data
      </div>
    );
    const W = 280, H = 70, pad = 8;
    const xs = trendPoints.map(p => pad + (p.i / 11) * (W - pad * 2));
    const vals = trendPoints.map(p => p.v);
    const minV = Math.min(...vals, -0.3), maxV = Math.max(...vals, 0.3);
    const ys = vals.map(v => H - pad - ((v - minV) / (maxV - minV)) * (H - pad * 2));
    const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
    const zeroY = H - pad - ((0 - minV) / (maxV - minV)) * (H - pad * 2);
    const areaPath = `M${xs[0]},${zeroY} ` + xs.map((x, i) => `L${x},${ys[i]}`).join(" ") + ` L${xs[xs.length-1]},${zeroY} Z`;
    const lastColor = vals[vals.length-1] > 0.1 ? "#22c55e" : vals[vals.length-1] < -0.1 ? "#ef4444" : "#f59e0b";
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow:"visible" }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lastColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lastColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Zero line */}
        {zeroY > pad && zeroY < H - pad && (
          <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke={T.border} strokeWidth="1" strokeDasharray="3,3" />
        )}
        <path d={areaPath} fill="url(#trendGrad)" />
        <polyline points={polyline} fill="none" stroke={lastColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {trendPoints.map((p, i) => (
          <circle key={i} cx={xs[i]} cy={ys[i]} r="3" fill={lastColor} stroke={T.bg} strokeWidth="1.5" />
        ))}
      </svg>
    );
  };

  // ── Top movers by sentiment ────────────────────────────────────────────────
  const sorted = [...withData].sort((a, b) => b.runs[0].sentimentScore - a.runs[0].sentimentScore);
  const topPos = sorted.slice(0, 3);
  const topNeg = [...sorted].reverse().slice(0, 3);

  // ── Top by coverage volume ─────────────────────────────────────────────────
  const byArt = [...withData].sort((a, b) => (b.runs[0].mediaCount||0) - (a.runs[0].mediaCount||0)).slice(0, 5);
  const bySOC = [...withData].sort((a, b) => (b.runs[0].socialCount||0) - (a.runs[0].socialCount||0)).slice(0, 5);
  const maxArt = Math.max(...byArt.map(c => c.runs[0].mediaCount||0), 1);
  const maxSoc = Math.max(...bySOC.map(c => c.runs[0].socialCount||0), 1);

  const Card = ({ title, children, style }) => (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"14px 16px", ...style }}>
      <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );

  const MoverRow = ({ company, showBar }) => {
    const s = company.runs[0].sentimentScore;
    const c = s > 0.1 ? "#22c55e" : s < -0.1 ? "#ef4444" : "#f59e0b";
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
        <div style={{ flex:1, fontSize:11, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.name}</div>
        {showBar && (
          <div style={{ width:60, height:5, background:T.ghost, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${Math.min(100,(s+1)/2*100)}%`, background:c, borderRadius:3 }} />
          </div>
        )}
        <div style={{ fontSize:11, fontWeight:700, color:c, width:38, textAlign:"right", flexShrink:0 }}>{s >= 0 ? "+" : ""}{s.toFixed(2)}</div>
      </div>
    );
  };

  const CoverageRow = ({ company, field, max }) => {
    const val = company.runs[0][field] || 0;
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <div style={{ width:110, fontSize:11, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flexShrink:0 }}>{company.name}</div>
        <div style={{ flex:1, height:6, background:T.ghost, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${Math.max(3, val/max*100)}%`, background:T.accent, borderRadius:3, opacity:0.8 }} />
        </div>
        <div style={{ width:32, textAlign:"right", fontSize:11, color:T.dim, flexShrink:0 }}>{val}</div>
      </div>
    );
  };

  return (
    <div style={{ marginBottom:24 }}>
      {/* Row 1: Health score + trend + stats */}
      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr 140px 140px", gap:10, marginBottom:10 }}>
        {/* Health gauge */}
        <Card title="Portfolio Health">
          <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
            <span style={{ fontSize:30, fontWeight:900, color:sentColor, letterSpacing:"-0.04em" }}>{avgSent >= 0 ? "+" : ""}{avgSent.toFixed(2)}</span>
            <span style={{ fontSize:12, color:sentColor, fontWeight:700 }}>{sentLabel}</span>
          </div>
          <div style={{ position:"relative", height:10, borderRadius:5, background:"linear-gradient(to right,#ef4444 0%,#f59e0b 50%,#22c55e 100%)" }}>
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"50%", transform:"translate(-50%,-50%)", width:18, height:18, borderRadius:"50%", background:sentColor, border:`2.5px solid ${T.bg}`, boxShadow:"0 1px 6px rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center" }} />
            {/* Label callout */}
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"calc(100% + 6px)", transform:"translateX(-50%)", fontSize:9, fontWeight:700, color:sentColor, whiteSpace:"nowrap", background:T.bg, padding:"1px 4px", borderRadius:3, border:`1px solid ${sentColor}40` }}>{avgSent >= 0 ? "+" : ""}{avgSent.toFixed(2)}</div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:T.faint, marginTop:18 }}>
            <span>Negative</span><span>Neutral</span><span>Positive</span>
          </div>
          <div style={{ marginTop:6, fontSize:10, color:T.dim }}>{withData.length} companies with data</div>
        </Card>

        {/* Trend */}
        <Card title={`Sentiment trend — last 90 days (${points.length} data points)`}>
          <TrendLine />
        </Card>

        {/* Total articles */}
        <Card title="Total Coverage">
          <div style={{ fontSize:28, fontWeight:800, color:T.text, letterSpacing:"-0.03em" }}>{totalArt.toLocaleString()}</div>
          <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>articles across portfolio</div>
          <div style={{ marginTop:10, fontSize:22, fontWeight:800, color:T.text, letterSpacing:"-0.02em" }}>{totalSoc.toLocaleString()}</div>
          <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>social posts</div>
        </Card>

        {/* Coverage vs no data */}
        <Card title="Data Coverage">
          {(() => {
            const enabled = companies.filter(c => c.enabled !== false);
            const pct = Math.round(withData.length / Math.max(enabled.length, 1) * 100);
            return (
              <>
                <div style={{ fontSize:28, fontWeight:800, color:T.accent, letterSpacing:"-0.03em" }}>{pct}%</div>
                <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>{withData.length} of {enabled.length} companies</div>
                <div style={{ marginTop:10, height:6, background:T.ghost, borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:T.accent, borderRadius:3 }} />
                </div>
                <div style={{ marginTop:8, fontSize:10, color:T.faint }}>{enabled.length - withData.length} need a run</div>
              </>
            );
          })()}
        </Card>
      </div>

      {/* Row 2: Top movers + coverage leaders */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
        <Card title="Top performers">
          {topPos.map(c => <MoverRow key={c.id} company={c} showBar />)}
        </Card>
        <Card title="Watch list (lowest sentiment)">
          {topNeg.map(c => <MoverRow key={c.id} company={c} showBar />)}
        </Card>
        <Card title="Most articles">
          {byArt.map(c => <CoverageRow key={c.id} company={c} field="mediaCount" max={maxArt} />)}
        </Card>
        <Card title="Most social posts">
          {bySOC.map(c => <CoverageRow key={c.id} company={c} field="socialCount" max={maxSoc} />)}
        </Card>
      </div>
    </div>
  );
}

// ── Portfolio Dashboard ───────────────────────────────────────────────────────

function Portfolio({ companies, settings, onSelect, onRun, onRunAll, onUpdateCompany, onAdd, onUpdateSettings }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [sort, setSort] = useState("name");
  const [showDisabled, setShowDisabled] = useState(false);
  const [running, setRunning] = useState(null);

  const firmEntry = companies.find(c => c.isFirm);
  const portfolioCompanies = companies.filter(c => !c.isFirm);

  const allCats = useMemo(() => {
    const s = new Set();
    portfolioCompanies.forEach(c => (c.categories || []).forEach(x => s.add(x)));
    return ["All", ...Array.from(s).sort()];
  }, [portfolioCompanies]);

  const filtered = useMemo(() => {
    let list = portfolioCompanies.filter(c => showDisabled || c.enabled !== false);
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== "All") list = list.filter(c => (c.categories || []).includes(catFilter));
    const lastRun = c => c.runs?.[0];
    list = [...list].sort((a, b) => {
      if (sort === "name")      return a.name.localeCompare(b.name);
      if (sort === "sentiment") return (lastRun(b)?.sentimentScore || 0) - (lastRun(a)?.sentimentScore || 0);
      if (sort === "articles")  return (lastRun(b)?.mediaCount || 0) - (lastRun(a)?.mediaCount || 0);
      if (sort === "recent")    return (lastRun(b)?.ranAt || "").localeCompare(lastRun(a)?.ranAt || "");
      return 0;
    });
    return list;
  }, [companies, search, catFilter, sort, showDisabled]);

  const activeCount = portfolioCompanies.filter(c => c.enabled !== false && c.runs?.[0]?.isLive).length;
  const avgSent = (() => {
    const withData = portfolioCompanies.filter(c => c.runs?.[0]?.sentimentScore !== undefined);
    if (!withData.length) return null;
    return withData.reduce((s, c) => s + c.runs[0].sentimentScore, 0) / withData.length;
  })();

  const handleRunAll = async () => {
    setRunning("all");
    await onRunAll();
    setRunning(null);
  };

  const handleRunOne = async (c, e) => {
    e.stopPropagation();
    setRunning(c.id);
    await onRun(c);
    setRunning(null);
  };

  const handlePortfolioDownload = () => {
    const dateStr = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
    const withData = portfolioCompanies.filter(c => c.runs?.[0]?.sentimentScore !== undefined);
    const totalArticles = withData.reduce((s, c) => s + (c.runs[0].mediaCount || 0), 0);
    const totalSocial   = withData.reduce((s, c) => s + (c.runs[0].socialCount || 0), 0);
    const sorted = [...portfolioCompanies].sort((a, b) => {
      const aS = a.runs?.[0]?.sentimentScore ?? -99;
      const bS = b.runs?.[0]?.sentimentScore ?? -99;
      return bS - aS;
    });

    const sentColor = s => s > 0.2 ? "#16a34a" : s < -0.2 ? "#dc2626" : "#d97706";

    const rows = sorted.map(c => {
      const run = c.runs?.[0];
      const s = run?.sentimentScore;
      const hasRun = s !== undefined;
      return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-weight:700;color:#111">${c.name}${c.isFirm ? " ★" : ""}</td>
        <td style="padding:10px 12px;color:#6b7280;font-size:11px">${(c.categories||[]).slice(0,2).join(", ") || "—"}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:${hasRun ? sentColor(s) : "#9ca3af"}">${hasRun ? (s >= 0 ? "+" : "") + s.toFixed(2) : "—"}</td>
        <td style="padding:10px 12px;text-align:right">${hasRun ? (run.mediaCount||0).toLocaleString() : "—"}</td>
        <td style="padding:10px 12px;text-align:right">${hasRun ? (run.socialCount||0).toLocaleString() : "—"}</td>
        <td style="padding:10px 12px;text-align:right;color:#9ca3af;font-size:11px">${run?.ranAt ? run.ranAt.slice(0,10) : "—"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Radical Ventures — Portfolio Intelligence Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 28px; color: #111; background: #fff; }
  @media print { body { margin: 20px; } }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid #111; }
  th.r { text-align: right; }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
</style>
</head><body>

<div style="border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:28px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between">
    <div>
      <h1 style="font-size:24px;font-weight:900;margin:0;letter-spacing:-0.03em">Radical Ventures — Portfolio Intelligence Report</h1>
      <p style="color:#6b7280;font-size:13px;margin:6px 0 0">Prepared by Radical Intelligence Platform · ${dateStr}</p>
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af">
      ${portfolioCompanies.length} companies monitored<br>
      ${withData.length} with data · ${totalArticles.toLocaleString()} articles · ${totalSocial.toLocaleString()} social posts
    </div>
  </div>
</div>

${withData.length > 0 ? `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Portfolio Avg Sentiment</div>
    <div style="font-size:28px;font-weight:900;color:${sentColor(avgSent || 0)}">${(avgSent||0) >= 0 ? "+" : ""}${(avgSent||0).toFixed(2)}</div>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Total Articles</div>
    <div style="font-size:28px;font-weight:900;color:#111">${totalArticles.toLocaleString()}</div>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Total Social Posts</div>
    <div style="font-size:28px;font-weight:900;color:#111">${totalSocial.toLocaleString()}</div>
  </div>
</div>` : ""}

<h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Company Breakdown</h2>
<table>
  <thead><tr>
    <th>Company</th>
    <th>Categories</th>
    <th class="r">Sentiment</th>
    <th class="r">Articles</th>
    <th class="r">Social</th>
    <th class="r">Last Run</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Generated by Radical Intelligence Platform · Radical Ventures · ${dateStr}
</div>

</body></html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  return (
    <div style={{ padding:"28px 32px", maxWidth:1400, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:T.text, letterSpacing:"-0.02em" }}>Portfolio</div>
          <div style={{ fontSize:12, color:T.dim, marginTop:4 }}>
            {companies.filter(c => c.enabled !== false).length} monitored · {activeCount} with data
            {avgSent !== null && <> · Avg sentiment: <span style={{ color:sc(avgSent), fontWeight:700 }}>{avgSent > 0 ? "+" : ""}{avgSent.toFixed(2)}</span></>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {/* Quick source toggles */}
          {[
            { key:"newsEnabled",    label:"News",    color:"#60a5fa", default:true },
            { key:"twitterEnabled", label:"Twitter", color:"#1d9bf0" },
          ].map(s => {
            const on = settings.features?.[s.key] ?? s.default ?? false;
            return (
              <button key={s.key} onClick={() => onUpdateSettings({ ...settings, features: { ...settings.features, [s.key]: !on } })}
                title={`${on ? "Disable" : "Enable"} ${s.label} for all runs`}
                style={{ padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:700, cursor:"pointer", border:`1px solid ${on ? s.color+"60" : T.border}`, background:on ? `${s.color}18` : "transparent", color:on ? s.color : T.faint, display:"flex", alignItems:"center", gap:4 }}>
                {on ? "●" : "○"} {s.label}
              </button>
            );
          })}
          <Btn onClick={handlePortfolioDownload} variant="ghost" style={{ fontSize:11 }}>⬇ Download</Btn>
          <Btn onClick={onAdd} variant="ghost">+ Add</Btn>
          <Btn onClick={handleRunAll} variant="primary" disabled={running === "all"}>
            {running === "all" ? <><Spinner /> Running all…</> : "▶ Run all"}
          </Btn>
        </div>
      </div>

      {/* Portfolio health */}
      <PortfolioHealth companies={portfolioCompanies} />

      {/* Filters */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
        <Input value={search} onChange={setSearch} placeholder="Search companies…" style={{ width:220 }} />
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 10px", fontSize:12, color:T.text, outline:"none" }}>
          <option value="name">Sort: A–Z</option>
          <option value="sentiment">Sort: Sentiment</option>
          <option value="articles">Sort: Article count</option>
          <option value="recent">Sort: Most recent</option>
        </select>
        <select value={settings.dateRange} onChange={e => onUpdateSettings({ ...settings, dateRange: e.target.value })} style={{ background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 10px", fontSize:12, color:T.text, outline:"none" }}>
          {DATE_RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1 }}>
          {allCats.slice(0, 10).map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)} style={{ padding:"4px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${catFilter===cat ? T.accent+"80" : T.border}`, background:catFilter===cat ? T.accentDim : "transparent", color:catFilter===cat ? T.accent : T.dim }}>
              {cat}
            </button>
          ))}
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:T.dim, cursor:"pointer" }}>
          <input type="checkbox" checked={showDisabled} onChange={e => setShowDisabled(e.target.checked)} />
          Show paused
        </label>
      </div>

      {/* Company grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:12 }}>
        {filtered.map(c => {
          const run = c.runs?.[0];
          const isRunning = running === c.id;
          const sentScore = run?.sentimentScore;
          return (
            <div key={c.id} onClick={() => onSelect(c)}
              style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 18px", cursor:"pointer", display:"flex", flexDirection:"column", gap:10, transition:"all 0.15s", opacity:c.enabled===false?0.55:1 }}
              onMouseEnter={e => e.currentTarget.style.background = T.cardHover}
              onMouseLeave={e => e.currentTarget.style.background = T.card}
            >
              {/* Top row */}
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:T.text, letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                  <div style={{ display:"flex", gap:4, marginTop:5, flexWrap:"wrap" }}>
                    {(c.categories || []).slice(0, 2).map(cat => (
                      <Tag key={cat} label={cat} color={CAT_COLOR[cat] || "#6b7280"} />
                    ))}
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                  <label onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }}>
                    <span style={{ fontSize:10, color:c.enabled!==false ? "#4ade80" : T.faint }}>{c.enabled!==false ? "● ON" : "○ OFF"}</span>
                    <input type="checkbox" checked={c.enabled!==false} onChange={e => { e.stopPropagation(); onUpdateCompany({ ...c, enabled: e.target.checked }); }} style={{ width:12, height:12, cursor:"pointer" }} />
                  </label>
                </div>
              </div>

              {/* Sentiment */}
              {sentScore !== undefined ? (
                <div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:sc(sentScore) }}>{sentScore > 0 ? "+" : ""}{sentScore.toFixed(2)} {sl(sentScore)}</span>
                    <span style={{ fontSize:10, color:T.faint }}>{run.mediaCount} articles · {run.socialCount} social</span>
                  </div>
                  <div style={{ height:4, borderRadius:2, background:T.ghost, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${Math.min(100, ((sentScore + 1) / 2) * 100)}%`, background:sc(sentScore), borderRadius:2, transition:"width 0.4s" }} />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize:11, color:T.faint, fontStyle:"italic" }}>No data — click Run to start</div>
              )}

              {/* Footer */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:T.faint }}>Last run: {ago(run?.ranAt)}</span>
                <div style={{ display:"flex", gap:6 }} onClick={e => e.stopPropagation()}>
                  <Btn onClick={() => onSelect(c)} variant="ghost" style={{ fontSize:11, padding:"4px 10px" }}>View</Btn>
                  <Btn onClick={e => handleRunOne(c, e)} variant="primary" disabled={isRunning} style={{ fontSize:11, padding:"4px 10px" }}>
                    {isRunning ? <><Spinner /> …</> : "▶ Run"}
                  </Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Radical Ventures firm monitoring section */}
      {firmEntry && (() => {
        const firmRun = firmEntry.runs?.[0];
        const firmSent = firmRun?.sentimentScore;
        const isRunningFirm = running === firmEntry.id;
        return (
          <div style={{ marginTop:40 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{ flex:1, height:1, background:T.border }} />
              <div style={{ fontSize:11, fontWeight:700, color:T.dim, letterSpacing:"0.08em", textTransform:"uppercase", whiteSpace:"nowrap" }}>Firm Intelligence</div>
              <div style={{ flex:1, height:1, background:T.border }} />
            </div>
            <div
              onClick={() => onSelect(firmEntry)}
              style={{ background:`linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.06) 100%)`, border:`1px solid rgba(99,102,241,0.3)`, borderRadius:14, padding:"20px 24px", cursor:"pointer", display:"flex", flexWrap:"wrap", gap:20, alignItems:"center", transition:"all 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.6)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)"}
            >
              {/* Name + description */}
              <div style={{ flex:"1 1 200px", minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <div style={{ width:28, height:28, borderRadius:8, background:"rgba(99,102,241,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>RV</div>
                  <div style={{ fontSize:17, fontWeight:800, color:T.text }}>Radical Ventures</div>
                </div>
                <div style={{ fontSize:11, color:T.dim }}>AI-focused venture fund · <a href="https://radical.vc" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color:"rgba(99,102,241,0.9)", textDecoration:"none" }}>radical.vc</a></div>
              </div>

              {/* Sentiment */}
              <div style={{ flex:"1 1 160px" }}>
                {firmSent !== undefined ? (
                  <>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Sentiment</div>
                    <div style={{ fontSize:20, fontWeight:800, color:sc(firmSent) }}>{firmSent > 0 ? "+" : ""}{firmSent.toFixed(2)}</div>
                    <div style={{ height:4, borderRadius:2, background:T.ghost, marginTop:6, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${Math.min(100, ((firmSent+1)/2)*100)}%`, background:sc(firmSent), borderRadius:2 }} />
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize:11, color:T.faint, fontStyle:"italic" }}>No data yet</div>
                )}
              </div>

              {/* Coverage counts */}
              {firmRun && (
                <div style={{ flex:"1 1 120px" }}>
                  <div style={{ fontSize:11, color:T.dim, marginBottom:6 }}>Coverage</div>
                  <div style={{ display:"flex", gap:16 }}>
                    <div><div style={{ fontSize:18, fontWeight:800, color:T.text }}>{firmRun.mediaCount || 0}</div><div style={{ fontSize:10, color:T.faint }}>Articles</div></div>
                    <div><div style={{ fontSize:18, fontWeight:800, color:T.text }}>{firmRun.socialCount || 0}</div><div style={{ fontSize:10, color:T.faint }}>Social</div></div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display:"flex", gap:8, alignItems:"center" }} onClick={e => e.stopPropagation()}>
                <Btn onClick={() => onSelect(firmEntry)} variant="ghost" style={{ fontSize:11, padding:"6px 14px" }}>View</Btn>
                <Btn
                  onClick={async e => { e.stopPropagation(); setRunning(firmEntry.id); await onRun(firmEntry); setRunning(null); }}
                  variant="primary"
                  disabled={isRunningFirm}
                  style={{ fontSize:11, padding:"6px 14px", background:"rgba(99,102,241,0.8)" }}
                >
                  {isRunningFirm ? <><Spinner /> …</> : "▶ Run"}
                </Btn>
              </div>

              {firmRun && (
                <div style={{ width:"100%", borderTop:`1px solid rgba(99,102,241,0.15)`, paddingTop:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:10, color:T.faint }}>Last run: {ago(firmRun.ranAt)}</span>
                  <span style={{ fontSize:10, color:T.faint }}>{firmEntry.dateRange || settings.dateRange} lookback</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Signals View ──────────────────────────────────────────────────────────────

function Signals({ companies }) {
  const signals = useMemo(() => {
    const out = [];
    companies.filter(c => c.enabled !== false && c.runs?.[0]).forEach(c => {
      const run = c.runs[0];
      const s = run.sentimentScore || 0;
      if (s < -0.5)  out.push({ company: c.name, sev:"critical", msg:`Very negative sentiment (${s.toFixed(2)})`, icon:"🔴", companyId:c.id });
      else if (s < -0.2) out.push({ company: c.name, sev:"high",    msg:`Negative sentiment (${s.toFixed(2)})`, icon:"🟠", companyId:c.id });
      (run.businessSignals || []).forEach(sig => {
        if (sig.type === "Risk") out.push({ company: c.name, sev:"high", msg:sig.summary, icon:"⚠️", companyId:c.id });
        if (sig.type === "Funding") out.push({ company: c.name, sev:"positive", msg:sig.summary, icon:"💰", companyId:c.id });
        if (sig.type === "Hiring") out.push({ company: c.name, sev:"positive", msg:sig.summary, icon:"👥", companyId:c.id });
      });
      if (!c.boolean_approved) out.push({ company: c.name, sev:"medium", msg:"Search query not reviewed — verify in Admin", icon:"⚙️", companyId:c.id });
    });
    const order = { critical:0, high:1, medium:2, positive:3 };
    return out.sort((a, b) => (order[a.sev] || 4) - (order[b.sev] || 4));
  }, [companies]);

  const sevColor = { critical:"#ef4444", high:"#f97316", medium:"#f59e0b", positive:"#22c55e" };

  return (
    <div style={{ padding:"28px 32px", maxWidth:900, margin:"0 auto" }}>
      <div style={{ fontSize:22, fontWeight:800, color:T.text, marginBottom:8 }}>Signals</div>
      <div style={{ fontSize:12, color:T.dim, marginBottom:24 }}>{signals.length} signals across portfolio</div>
      {signals.length === 0 && (
        <div style={{ textAlign:"center", padding:"60px 0", color:T.faint, fontSize:13 }}>No signals — run searches to generate data</div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {signals.map((sig, i) => (
          <div key={i} style={{ background:T.card, border:`1px solid ${sevColor[sig.sev]}30`, borderLeft:`3px solid ${sevColor[sig.sev]}`, borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:18 }}>{sig.icon}</span>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{sig.company}</span>
              <span style={{ fontSize:12, color:T.dim, marginLeft:10 }}>{sig.msg}</span>
            </div>
            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:10, background:`${sevColor[sig.sev]}20`, color:sevColor[sig.sev] }}>{sig.sev}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Company Detail — Overview tab ─────────────────────────────────────────────

function OverviewTab({ company, run }) {
  const [tierFilter, setTierFilter] = useState("All");
  const [platFilter, setPlatFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState(null);
  const [mediaLimit, setMediaLimit] = useState(50);
  const [socialLimit, setSocialLimit] = useState(50);

  if (!run) return (
    <div style={{ textAlign:"center", padding:"60px 0", color:T.faint }}>
      <div style={{ fontSize:40, marginBottom:16 }}>📰</div>
      <div style={{ fontSize:14, fontWeight:600 }}>No data yet</div>
      <div style={{ fontSize:12, marginTop:6 }}>Click ▶ Run Search above to fetch live news and social coverage</div>
    </div>
  );

  const mediaFiltered = (run.mediaResults || [])
    .filter(m => tierFilter === "All" || m.tier === parseInt(tierFilter.slice(1)))
    .filter(m => !selectedDate || m.date?.startsWith(selectedDate));
  const media = mediaFiltered.slice(0, mediaLimit);

  const socialFiltered = (run.socialResults || [])
    .filter(s => platFilter === "all" || s.platform === platFilter);
  const social = socialFiltered.slice(0, socialLimit);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
      {/* Sentiment summary */}
      {run.sentimentScore !== undefined && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", display:"flex", gap:24, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Sentiment</div>
            <SentimentChip score={run.sentimentScore} />
          </div>
          {run.keyDrivers?.length > 0 && (
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize:11, color:T.dim, marginBottom:6 }}>Key drivers</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {run.keyDrivers.map((d, i) => <Tag key={i} label={d} color={T.accent} />)}
              </div>
            </div>
          )}
          {run.businessSignals?.length > 0 && (
            <div>
              <div style={{ fontSize:11, color:T.dim, marginBottom:6 }}>Signals</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {run.businessSignals.map((s, i) => (
                  <div key={i} style={{ fontSize:11, color:T.text }}>
                    <span style={{ color:s.type==="Risk" ? "#f87171" : s.type==="Funding" ? "#22c55e" : T.accent, fontWeight:700 }}>{s.type}: </span>
                    {s.summary}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* News */}
      <div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, gap:10, flexWrap:"wrap" }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.text }}>News <span style={{ color:T.dim, fontWeight:400, fontSize:12 }}>({run.mediaCount || 0} articles)</span></div>
          <div style={{ display:"flex", gap:6 }}>
            {["All","T1","T2","T3"].map(t => (
              <button key={t} onClick={() => setTierFilter(t)} style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${tierFilter===t ? T.accent+"80" : T.border}`, background:tierFilter===t ? T.accentDim : "transparent", color:tierFilter===t ? T.accent : T.dim }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {(run.mediaResults || []).length > 0 && (
          <div style={{ marginBottom:12 }}>
            <ArticleTimeline articles={run.mediaResults} onDateClick={setSelectedDate} selectedDate={selectedDate} />
            {selectedDate && <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>Showing {selectedDate} · <button onClick={() => setSelectedDate(null)} style={{ background:"none", border:"none", color:T.accent, cursor:"pointer", fontSize:11 }}>Clear</button></div>}
          </div>
        )}
        {media.length === 0 ? (
          <div style={{ fontSize:12, color:T.faint, padding:"20px 0", textAlign:"center" }}>No articles match current filter</div>
        ) : (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:10 }}>
              {media.map(item => <ArticleCard key={item.id} item={item} />)}
            </div>
            {mediaFiltered.length > mediaLimit && (
              <div style={{ textAlign:"center", marginTop:12 }}>
                <Btn variant="ghost" onClick={() => setMediaLimit(l => l + 50)} style={{ fontSize:12 }}>
                  Show {Math.min(50, mediaFiltered.length - mediaLimit)} more articles ({mediaFiltered.length - mediaLimit} remaining)
                </Btn>
              </div>
            )}
          </>
        )}
      </div>

      {/* Social */}
      {(run.socialResults || []).length > 0 && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:14, fontWeight:700, color:T.text }}>Social <span style={{ color:T.dim, fontWeight:400, fontSize:12 }}>({run.socialCount || 0} posts)</span></div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {["all","twitter","reddit","linkedin","hackernews","web"].map(p => {
                const count = p === "all" ? run.socialResults.length : run.socialResults.filter(s => s.platform === p).length;
                if (p !== "all" && count === 0) return null;
                const meta = p === "all" ? { color:T.dim, icon:"All" } : PLAT[p];
                return (
                  <button key={p} onClick={() => setPlatFilter(p)} style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${platFilter===p ? meta.color+"80" : T.border}`, background:platFilter===p ? `${meta.color}20` : "transparent", color:platFilter===p ? meta.color : T.dim }}>
                    {meta.icon} {count > 0 && <span style={{ opacity:0.6 }}>({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <SocialInsights posts={socialFiltered} />
          {(() => {
            const topEngId = [...socialFiltered].sort((a,b)=>(b.engagementScore||0)-(a.engagementScore||0))[0]?.id;
            return (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:10, marginTop:12 }}>
                {social.map(item => <SocialCard key={item.id} item={item} highlight={item.id === topEngId} />)}
              </div>
            );
          })()}
          {socialFiltered.length > socialLimit && (
            <div style={{ textAlign:"center", marginTop:12 }}>
              <Btn variant="ghost" onClick={() => setSocialLimit(l => l + 50)} style={{ fontSize:12 }}>
                Show {Math.min(50, socialFiltered.length - socialLimit)} more posts ({socialFiltered.length - socialLimit} remaining)
              </Btn>
            </div>
          )}
        </div>
      )}

      {/* Sentiment history */}
      {company.runs?.length > 1 && (
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:10 }}>Sentiment history</div>
          <div style={{ display:"flex", gap:10 }}>
            {[...company.runs].reverse().map((r, i) => (
              <div key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 14px", flex:1, textAlign:"center" }}>
                <div style={{ fontSize:10, color:T.faint, marginBottom:4 }}>{r.ranAt?.slice(0, 10)}</div>
                <SentimentChip score={r.sentimentScore || 0} />
                <div style={{ fontSize:10, color:T.dim, marginTop:4 }}>{r.mediaCount} art · {r.socialCount} soc</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────

function DonutChart({ data, size = 164, thickness = 30, centerLabel }) {
  const cx = size / 2, cy = size / 2;
  const r  = (size - thickness) / 2;
  const C  = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (total === 0) return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:T.ghost, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <span style={{ fontSize:11, color:T.faint }}>No data</span>
    </div>
  );
  let cum = 0;
  const segs = data.map(d => {
    const pct   = (d.value || 0) / total;
    const dash  = pct * C;
    const gap   = C - dash;
    const start = cum;
    cum += dash;
    return { ...d, dash, gap, start };
  });
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.ghost} strokeWidth={thickness} />
        {segs.map((s, i) => s.value > 0 && (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={thickness - 2}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeDashoffset={C - s.start}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {centerLabel && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:thickness + 4 }}>
          {centerLabel}
        </div>
      )}
    </div>
  );
}

// ── Company Detail — SOV tab ──────────────────────────────────────────────────

function SovSection({ title, children }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
      <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:14 }}>{title}</div>
      {children}
    </div>
  );
}

function SOVTab({ company, settings, onUpdate, toast }) {
  const [editMode, setEditMode] = useState(false);
  const [newComp, setNewComp] = useState("");
  const [localComps, setLocalComps] = useState(null); // staged buffer while editing
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const sov = company.sovRun;
  // During edit mode, display the local buffer; otherwise show saved state
  const competitors = editMode ? (localComps || company.competitors || []) : (company.competitors || []);

  const startEdit = () => {
    setLocalComps([...(company.competitors || [])]);
    setEditMode(true);
  };

  // Commit all staged changes to persistent state
  const handleDone = () => {
    let finalComps = localComps || [];
    // Auto-add anything still typed in the input field
    if (newComp.trim()) {
      const name = newComp.trim();
      const isDupe = finalComps.some(c => c.name.toLowerCase() === name.toLowerCase());
      if (!isDupe) finalComps = [...finalComps, { id: `c-${Date.now()}`, name, rationale: "" }];
      setNewComp("");
    }
    onUpdate({ ...company, competitors: finalComps });
    toast(`${finalComps.length} competitor${finalComps.length !== 1 ? "s" : ""} saved`, "success");
    setLocalComps(null);
    setEditMode(false);
  };

  const handleCancel = () => {
    setNewComp("");
    setLocalComps(null);
    setEditMode(false);
  };

  // Modify the local buffer only — nothing is persisted until Done
  const handleAdd = () => {
    const name = newComp.trim();
    if (!name) return;
    const isDupe = (localComps || []).some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!isDupe) setLocalComps(prev => [...(prev || []), { id: `c-${Date.now()}`, name, rationale: "" }]);
    setNewComp("");
  };

  const handleRemove = id => {
    setLocalComps(prev => (prev || []).filter(c => c.id !== id));
  };

  const handleRun = async () => {
    if (!settings.apiKeys.newsapi && !settings.apiKeys.yutori) {
      toast("Add NewsAPI or Yutori key in Admin → API Keys", "error"); return;
    }
    setRunning(true);
    try {
      const result = await runSOV(company, competitors, settings, setProgress);
      onUpdate({ ...company, sovRun: result });
      toast("SOV complete", "success");
    } catch (e) {
      toast("SOV failed: " + e.message, "error");
    }
    setRunning(false);
    setProgress("");
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const raw = await callLLM(
        `Company: ${company.name}\nDescription: ${company.description}\nCategories: ${(company.categories || []).join(", ")}\nCurrent competitors: ${competitors.map(c => c.name).join(", ") || "none"}\n\nSuggest 3 direct competitors not already listed. Return JSON: {"competitors":[{"name":"...","rationale":"..."}]}`,
        "You are a VC analyst. Return ONLY valid JSON.",
        settings.apiKeys
      );
      const parsed = parseJSON(raw);
      if (parsed?.competitors?.length) {
        const existing = new Set(competitors.map(c => c.name.toLowerCase()));
        const newOnes = parsed.competitors.filter(c => !existing.has(c.name.toLowerCase()));
        onUpdate({ ...company, competitors: [...competitors, ...newOnes.map(c => ({ id: `c-${Date.now()}-${Math.random()}`, name: c.name, rationale: c.rationale }))] });
        toast(`Added ${newOnes.length} suggested competitors`, "success");
      }
    } catch { toast("Suggest failed", "error"); }
    setSuggesting(false);
  };

  const [aiSummary, setAiSummary] = useState(sov?.aiSummary || "");
  const [aiLoading, setAiLoading] = useState(false);

  // Assign deterministic colors: base company always gets index 0
  const coloredResults = (() => {
    if (!sov?.results) return [];
    let peerIdx = 1;
    return sov.results.map(r => ({ ...r, color: r.isBase ? SOV_PALETTE[0] : SOV_PALETTE[peerIdx++ % SOV_PALETTE.length] }));
  })();
  const byMedia   = [...coloredResults].sort((a,b) => (b.mediaCount||0)-(a.mediaCount||0));
  const bySocial  = [...coloredResults].sort((a,b) => (b.socialCount||0)-(a.socialCount||0));
  const totalMedia  = coloredResults.reduce((s,r) => s+(r.mediaCount||0), 0);
  const totalSocial = coloredResults.reduce((s,r) => s+(r.socialCount||0), 0);
  const maxMedia  = Math.max(...coloredResults.map(r => r.mediaCount||0), 1);
  const maxSocial = Math.max(...coloredResults.map(r => r.socialCount||0), 1);
  const hasSocial = coloredResults.some(r => r.socialCount > 0);

  const handleAISummary = async () => {
    if (!sov?.results?.length || !settings.apiKeys.openai && !settings.apiKeys.anthropic && !settings.apiKeys.openrouter) return;
    setAiLoading(true);
    try {
      const rows = coloredResults.map(r =>
        `${r.name}${r.isBase?" (focal company)":""}: press=${r.mediaCount||0} articles (${totalMedia > 0 ? Math.round((r.mediaCount||0)/totalMedia*100) : 0}% SOV), social=${r.socialCount||0} posts (${totalSocial > 0 ? Math.round((r.socialCount||0)/totalSocial*100) : 0}% SOV), sentiment=${(r.sentiment||0).toFixed(2)} (${sl(r.sentiment||0)})`
      ).join("\n");
      const prompt = `You are a competitive intelligence analyst advising a VC fund. Analyse this share-of-voice data for ${company.name} vs peers:\n\n${rows}\n\nWrite a concise 3-paragraph competitive analysis:\n1. Coverage dominance: who leads press share of voice and why it matters\n2. Sentiment positioning: who has strongest/weakest sentiment and what that signals\n3. Strategic implications for ${company.name}: specific actionable observations\n\nBe data-specific (reference actual numbers). No bullet points — flowing prose.`;
      const resp = await callLLM(prompt, "You are a competitive intelligence analyst. Be concise, specific, and insight-driven.", settings.apiKeys);
      setAiSummary(resp);
      onUpdate({ ...company, sovRun: { ...sov, aiSummary: resp } });
    } catch { toast("AI summary failed", "error"); }
    setAiLoading(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Competitor management */}
      <SovSection title={`Competitors (${competitors.length})`}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ display:"flex", gap:6 }}>
            <Btn onClick={handleSuggest} disabled={suggesting} variant="ghost" style={{ fontSize:11 }}>{suggesting ? <><Spinner /> Suggesting…</> : "✨ AI suggest"}</Btn>
            {editMode ? (
              <>
                <Btn onClick={handleDone} variant="primary" style={{ fontSize:11 }}>✓ Done</Btn>
                <Btn onClick={handleCancel} variant="ghost" style={{ fontSize:11 }}>Cancel</Btn>
              </>
            ) : (
              <Btn onClick={startEdit} variant="ghost" style={{ fontSize:11 }}>Edit</Btn>
            )}
          </div>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {competitors.map(c => (
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:6, background:T.ghost, padding:"5px 10px", borderRadius:20, fontSize:12, color:T.text }}>
              {c.name}
              {editMode && <button onClick={() => handleRemove(c.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", padding:0, fontSize:14, lineHeight:1 }}>×</button>}
            </div>
          ))}
          {competitors.length === 0 && <span style={{ fontSize:12, color:T.faint }}>No competitors added yet</span>}
        </div>
        {editMode && (
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <Input value={newComp} onChange={setNewComp} placeholder="Add competitor name…" />
            <Btn onClick={handleAdd} variant="primary">Add</Btn>
          </div>
        )}
      </SovSection>

      {/* Run button */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <Btn onClick={handleRun} disabled={running} variant="primary" style={{ padding:"8px 18px", fontSize:13 }}>
          {running ? <><Spinner /> {progress || "Running…"}</> : "▶ Run Share of Voice"}
        </Btn>
        {settings.apiKeys.yutori && settings.features.yutoriResearch && (
          <span style={{ fontSize:11, color:T.faint }}>~${((competitors.length + 1) * 0.35).toFixed(2)} est. Yutori cost</span>
        )}
        {sov && <span style={{ fontSize:11, color:T.faint }}>Last run: {ago(sov.ranAt)}</span>}
      </div>

      {sov?.results?.length > 0 && (
        <>
          {/* ── Summary Scorecard ─────────────────────────────────── */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:10 }}>
            {[
              { label:"Companies tracked",  val: coloredResults.length,       unit:"" },
              { label:"Total press articles", val: totalMedia.toLocaleString(),  unit:"" },
              { label:"Total social posts",   val: totalSocial.toLocaleString(), unit:"" },
              { label:`${company.name} press SOV`, val: totalMedia > 0 ? `${Math.round(((coloredResults.find(r=>r.isBase)?.mediaCount||0)/totalMedia)*100)}%` : "—", unit:"" },
              { label:`${company.name} social SOV`, val: totalSocial > 0 ? `${Math.round(((coloredResults.find(r=>r.isBase)?.socialCount||0)/totalSocial)*100)}%` : "—", unit:"" },
              { label:`${company.name} sentiment`, val: sl(coloredResults.find(r=>r.isBase)?.sentiment||0), unit:"", color: sc(coloredResults.find(r=>r.isBase)?.sentiment||0) },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
                <div style={{ fontSize:10, color:T.faint, marginBottom:4, lineHeight:1.3 }}>{label}</div>
                <div style={{ fontSize:18, fontWeight:800, color: color || T.text, letterSpacing:"-0.02em" }}>{val}</div>
              </div>
            ))}
          </div>

          {/* ── Pie Charts ────────────────────────────────────────── */}
          <div style={{ display:"grid", gridTemplateColumns: hasSocial ? "1fr 1fr" : "1fr", gap:16 }}>
            {/* Press SOV pie */}
            <SovSection title="Press Share of Voice">
              <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
                <DonutChart
                  data={byMedia.map(r => ({ value: r.mediaCount||0, color: r.color, name: r.name }))}
                  centerLabel={
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{totalMedia}</div>
                      <div style={{ fontSize:9, color:T.faint }}>articles</div>
                    </div>
                  }
                />
                <div style={{ display:"flex", flexDirection:"column", gap:7, minWidth:0, flex:1 }}>
                  {byMedia.map(r => (
                    <div key={r.name} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                      <div style={{ fontSize:11, fontWeight: r.isBase?700:400, color: r.isBase?T.text:T.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1, minWidth:0 }}>{r.name}</div>
                      <div style={{ fontSize:11, fontWeight:600, color:T.dim, flexShrink:0 }}>{r.mediaCount||0}</div>
                      <div style={{ fontSize:10, color:T.faint, width:32, textAlign:"right", flexShrink:0 }}>{totalMedia > 0 ? `${Math.round((r.mediaCount||0)/totalMedia*100)}%` : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </SovSection>

            {/* Social SOV pie */}
            {hasSocial && (
              <SovSection title="Social Share of Voice">
                <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
                  <DonutChart
                    data={bySocial.map(r => ({ value: r.socialCount||0, color: r.color, name: r.name }))}
                    centerLabel={
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{totalSocial}</div>
                        <div style={{ fontSize:9, color:T.faint }}>posts</div>
                      </div>
                    }
                  />
                  <div style={{ display:"flex", flexDirection:"column", gap:7, minWidth:0, flex:1 }}>
                    {bySocial.map(r => (
                      <div key={r.name} style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                        <div style={{ fontSize:11, fontWeight: r.isBase?700:400, color: r.isBase?T.text:T.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1, minWidth:0 }}>{r.name}</div>
                        <div style={{ fontSize:11, fontWeight:600, color:T.dim, flexShrink:0 }}>{r.socialCount||0}</div>
                        <div style={{ fontSize:10, color:T.faint, width:32, textAlign:"right", flexShrink:0 }}>{totalSocial > 0 ? `${Math.round((r.socialCount||0)/totalSocial*100)}%` : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </SovSection>
            )}
          </div>

          {/* ── Competitive Matrix ────────────────────────────────── */}
          <SovSection title="Competitive Matrix">
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                    {["Company","Press Articles","Press SOV","Social Posts","Social SOV","Sentiment","Position"].map(h => (
                      <th key={h} style={{ textAlign: h==="Company"?"left":"right", padding:"6px 10px", fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byMedia.map((r, i) => {
                    const pressSov  = totalMedia  > 0 ? (r.mediaCount||0)/totalMedia  : 0;
                    const socialSov = totalSocial > 0 ? (r.socialCount||0)/totalSocial : 0;
                    const s = r.sentiment || 0;
                    return (
                      <tr key={r.name} style={{ borderBottom:`1px solid ${T.border}22`, background: i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
                        <td style={{ padding:"8px 10px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                            <span style={{ fontWeight: r.isBase?700:500, color: r.isBase?T.text:T.dim }}>{r.name}</span>
                            {r.isBase && <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, background:`${T.accent}25`, color:T.accent }}>YOU</span>}
                          </div>
                        </td>
                        <td style={{ textAlign:"right", padding:"8px 10px", color:T.text, fontWeight:600 }}>{(r.mediaCount||0).toLocaleString()}</td>
                        <td style={{ textAlign:"right", padding:"8px 10px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
                            <div style={{ width:60, height:5, background:T.ghost, borderRadius:3, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${pressSov*100}%`, background:r.color, borderRadius:3 }} />
                            </div>
                            <span style={{ color:T.dim, fontSize:11, width:34, textAlign:"right" }}>{Math.round(pressSov*100)}%</span>
                          </div>
                        </td>
                        <td style={{ textAlign:"right", padding:"8px 10px", color:T.text, fontWeight:600 }}>{(r.socialCount||0).toLocaleString()}</td>
                        <td style={{ textAlign:"right", padding:"8px 10px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
                            <div style={{ width:60, height:5, background:T.ghost, borderRadius:3, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${socialSov*100}%`, background:r.color, borderRadius:3 }} />
                            </div>
                            <span style={{ color:T.dim, fontSize:11, width:34, textAlign:"right" }}>{Math.round(socialSov*100)}%</span>
                          </div>
                        </td>
                        <td style={{ textAlign:"right", padding:"8px 10px" }}>
                          <SentimentChip score={s} />
                        </td>
                        <td style={{ textAlign:"right", padding:"8px 10px" }}>
                          <span style={{ fontSize:10, color:T.faint }}>
                            {pressSov > 0.4 ? "🏆 Dominant" : pressSov > 0.25 ? "📈 Strong" : pressSov > 0.1 ? "📊 Present" : "🔍 Niche"}
                            {s > 0.3 && " · 😊"}{s < -0.2 && " · ⚠️"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SovSection>

          {/* ── Sentiment Comparison ──────────────────────────────── */}
          <SovSection title="Sentiment Comparison">
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {/* Gradient scale labels */}
              <div style={{ display:"grid", gridTemplateColumns:"140px 1fr 60px", gap:8, alignItems:"center", marginBottom:2 }}>
                <div />
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:T.faint }}>
                  <span>Very Negative (−1)</span><span>Neutral (0)</span><span>Very Positive (+1)</span>
                </div>
                <div />
              </div>
              {/* Per-company sentiment bars */}
              {[...coloredResults].sort((a,b) => (b.sentiment||0)-(a.sentiment||0)).map(r => {
                const s = r.sentiment || 0;
                // Bar from centre: negative goes left, positive goes right
                const pct = Math.abs(s) * 50; // 0–50% of half-width
                const isPos = s >= 0;
                return (
                  <div key={r.name} style={{ display:"grid", gridTemplateColumns:"140px 1fr 60px", gap:8, alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                      <span style={{ fontSize:11, fontWeight: r.isBase?700:400, color: r.isBase?T.text:T.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}</span>
                    </div>
                    {/* Two-sided bar centred at 50% */}
                    <div style={{ position:"relative", height:8, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
                      <div style={{ position:"absolute", top:0, bottom:0, width:"1px", left:"50%", background:T.border, zIndex:1 }} />
                      <div style={{
                        position:"absolute", top:1, bottom:1, borderRadius:3,
                        background: r.color,
                        left:  isPos ? "50%"           : `${50 - pct}%`,
                        width: `${pct}%`,
                        minWidth: s !== 0 ? 3 : 0,
                      }} />
                    </div>
                    <SentimentChip score={s} />
                  </div>
                );
              })}
            </div>
          </SovSection>

          {/* ── AI Competitive Analysis ───────────────────────────── */}
          <SovSection title="AI Competitive Analysis">
            {aiSummary ? (
              <div>
                <div style={{ fontSize:12, color:T.dim, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{aiSummary}</div>
                <div style={{ marginTop:12 }}>
                  <Btn onClick={handleAISummary} disabled={aiLoading} variant="ghost" style={{ fontSize:11 }}>
                    {aiLoading ? <><Spinner /> Regenerating…</> : "↻ Regenerate"}
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:10 }}>
                <p style={{ fontSize:12, color:T.dim, margin:0 }}>
                  Generate an AI-written narrative covering coverage dominance, sentiment positioning, and strategic implications for {company.name}.
                </p>
                <Btn onClick={handleAISummary} disabled={aiLoading} variant="primary" style={{ fontSize:12 }}>
                  {aiLoading ? <><Spinner /> Analysing…</> : "✨ Generate Competitive Analysis"}
                </Btn>
              </div>
            )}
          </SovSection>

          {/* ── Coverage Snapshots ────────────────────────────────── */}
          {(() => {
            // Focal company articles from main run; competitor articles from SOV topArticles
            const focalRun = company.runs?.[0];
            const focalArticles = (focalRun?.mediaResults || []).slice(0, 5).map(a => ({
              title: a.title, source: a.source, url: a.url, date: a.date, sentiment: a.sentiment || 0,
            }));
            const focalSocial = (focalRun?.socialResults || []).slice(0, 4);
            const competitorSnaps = coloredResults.filter(r => !r.isBase && r.topArticles?.length);
            const hasFocal = focalArticles.length > 0 || focalSocial.length > 0;
            const hasSnaps = hasFocal || competitorSnaps.length > 0;
            if (!hasSnaps) return null;

            const ArticleRow = ({ a, color }) => (
              <a href={a.url || "#"} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none", display:"block" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"7px 0", borderBottom:`1px solid ${T.border}22`, cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.querySelector(".atitle").style.color = color}
                  onMouseLeave={e => e.currentTarget.querySelector(".atitle").style.color = T.text}>
                  <div style={{ width:3, minHeight:32, borderRadius:2, background:color, flexShrink:0, marginTop:2 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="atitle" style={{ fontSize:11, fontWeight:600, color:T.text, lineHeight:1.4, transition:"color 0.15s" }}>{a.title}</div>
                    <div style={{ display:"flex", gap:8, marginTop:3 }}>
                      <span style={{ fontSize:10, color:T.faint }}>{a.source}</span>
                      {a.date && <span style={{ fontSize:10, color:T.faint }}>{a.date}</span>}
                      <span style={{ marginLeft:"auto", fontSize:10, fontWeight:600, color:sc(a.sentiment) }}>{a.sentiment > 0 ? "+" : ""}{a.sentiment.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </a>
            );

            const SocialRow = ({ s, color }) => (
              <a href={s.url || "#"} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none", display:"block" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"7px 0", borderBottom:`1px solid ${T.border}22` }}>
                  <div style={{ width:3, minHeight:28, borderRadius:2, background:color, flexShrink:0, marginTop:2 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                      <span style={{ fontSize:10, fontWeight:700, color: PLAT[s.platform]?.color || T.dim }}>{PLAT[s.platform]?.icon || "◈"} {s.author}</span>
                      {s.isVerified && <span style={{ fontSize:9, color:"#60a5fa" }}>✓</span>}
                      {s.followerCount > 0 && <span style={{ fontSize:9, color:T.faint }}>{fmt(s.followerCount)} followers</span>}
                    </div>
                    <div style={{ fontSize:11, color:T.dim, lineHeight:1.4 }}>{(s.text || "").slice(0, 160)}{(s.text || "").length > 160 ? "…" : ""}</div>
                    {(s.likes > 0 || s.retweets > 0) && (
                      <div style={{ display:"flex", gap:8, marginTop:3 }}>
                        {s.likes > 0    && <span style={{ fontSize:9, color:T.faint }}>♥ {fmt(s.likes)}</span>}
                        {s.retweets > 0 && <span style={{ fontSize:9, color:T.faint }}>↺ {fmt(s.retweets)}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </a>
            );

            return (
              <SovSection title="Coverage Snapshots">
                <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
                  {/* Focal company */}
                  {hasFocal && (() => {
                    const focalColor = coloredResults.find(r => r.isBase)?.color || SOV_PALETTE[0];
                    return (
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                          <div style={{ width:10, height:10, borderRadius:2, background:focalColor }} />
                          <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{company.name}</span>
                          <span style={{ fontSize:10, padding:"1px 6px", borderRadius:4, background:`${T.accent}20`, color:T.accent }}>YOU</span>
                        </div>
                        {focalArticles.map((a, i) => <ArticleRow key={i} a={a} color={focalColor} />)}
                        {focalSocial.length > 0 && (
                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:10, color:T.faint, marginBottom:4 }}>Top social posts</div>
                            {focalSocial.map((s, i) => <SocialRow key={i} s={s} color={focalColor} />)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Competitors */}
                  {competitorSnaps.map(r => (
                    <div key={r.name}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:r.color }} />
                        <span style={{ fontSize:11, fontWeight:600, color:T.dim }}>{r.name}</span>
                      </div>
                      {r.topArticles.slice(0, 5).map((a, i) => <ArticleRow key={i} a={a} color={r.color} />)}
                    </div>
                  ))}
                </div>
              </SovSection>
            );
          })()}
        </>
      )}

      {!sov && !running && (
        <div style={{ textAlign:"center", padding:"40px 0", color:T.faint, fontSize:12 }}>
          Add competitors above then click Run to compare share of voice
        </div>
      )}
    </div>
  );
}

// ── Company Detail — Ask AI tab ───────────────────────────────────────────────

function AskAITab({ company, settings }) {
  const run = company.runs?.[0];
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const QUICK_PROMPTS = [
    "Why is sentiment low?",
    "What are the key themes in recent coverage?",
    "Are there any risk or red-flag signals?",
    "What positive developments are mentioned?",
    "Summarise the most important business signals",
    "How does recent social activity compare to news coverage?",
  ];

  const buildContext = () => {
    if (!run) return "No data has been fetched for this company yet.";
    const media  = run.mediaResults  || [];
    const social = run.socialResults || [];
    const sent   = run.sentimentScore || 0;
    let ctx = `Company: ${company.name}\n`;
    ctx += `Categories: ${(company.categories || []).join(", ") || "—"}\n`;
    ctx += `Sentiment score: ${sent.toFixed(2)} (${sent > 0.2 ? "Positive" : sent < -0.2 ? "Negative" : "Neutral"})\n`;
    ctx += `Data window: ${run.fromDate || "unknown"} → today\n`;
    ctx += `Total coverage: ${media.length} articles, ${social.length} social posts\n`;
    if (run.keyDrivers?.length) ctx += `AI-identified key drivers: ${run.keyDrivers.join(", ")}\n`;
    if (run.businessSignals?.length) {
      ctx += `Business signals:\n`;
      run.businessSignals.forEach(s => ctx += `  • [${s.type}] ${s.summary}\n`);
    }
    if (media.length) {
      ctx += `\nRecent news articles (${media.length} total, top 20 shown):\n`;
      media.slice(0, 20).forEach((m, i) => {
        ctx += `${i+1}. [${m.date}] [${m.source || ""}] ${m.title || ""}: ${(m.snippet || "").slice(0, 250)}\n`;
      });
    }
    if (social.length) {
      ctx += `\nRecent social posts (${social.length} total, top 15 shown):\n`;
      social.slice(0, 15).forEach((s, i) => {
        ctx += `${i+1}. [${s.platform}] ${s.author} — likes:${s.likes} RT:${s.retweets||0}: ${(s.text || "").slice(0, 280)}\n`;
      });
    }
    return ctx;
  };

  const handleSend = async (questionOverride) => {
    const question = (questionOverride || input).trim();
    if (!question || loading) return;
    setInput("");
    const userMsg = { role:"user", content: question };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const context = buildContext();
      const systemPrompt = `You are an AI portfolio analyst for Radical Ventures, a leading AI-focused VC firm. You have access to the following recent media and social data for a portfolio company. Answer concisely and analytically, citing specific articles or posts where relevant. Be direct — avoid hedging language. If data is insufficient to answer, say so plainly.\n\n${context}`;
      const raw = await callLLM(question, systemPrompt, settings.apiKeys);
      setMessages(prev => [...prev, { role:"assistant", content: raw || "No response." }]);
    } catch(e) {
      setMessages(prev => [...prev, { role:"assistant", content:`⚠ Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  // Auto-scroll to bottom on new message
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  const hasLLM = !!(settings.apiKeys?.vertex_enabled !== false || settings.apiKeys?.gemini || settings.apiKeys?.anthropic || settings.apiKeys?.cohere_north_key || settings.apiKeys?.cohere);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:600, gap:0 }}>
      {!run && (
        <div style={{ padding:24, color:T.dim, fontSize:13, textAlign:"center" }}>
          Run a data fetch first to enable AI interrogation.
        </div>
      )}
      {!hasLLM && (
        <div style={{ padding:"10px 16px", background:"rgba(251,191,36,0.08)", border:`1px solid rgba(251,191,36,0.25)`, borderRadius:8, fontSize:12, color:"#fbbf24", marginBottom:12 }}>
          ⚠ No LLM configured. Add a Gemini, Anthropic, or Cohere key in Admin → API Keys to enable AI answers.
        </div>
      )}

      {/* Quick prompts */}
      {messages.length === 0 && run && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:T.dim, marginBottom:8 }}>Suggested questions:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {QUICK_PROMPTS.map(p => (
              <button key={p} onClick={() => handleSend(p)} disabled={loading || !hasLLM}
                style={{ padding:"6px 12px", borderRadius:20, fontSize:12, cursor:"pointer", border:`1px solid ${T.border}`, background:T.ghost, color:T.text, transition:"background 0.15s" }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message thread */}
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:12, paddingRight:4, marginBottom:12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700,
              background: msg.role === "user" ? T.accent : "rgba(99,102,241,0.2)", color: msg.role === "user" ? "#fff" : "#a5b4fc" }}>
              {msg.role === "user" ? "Y" : "✦"}
            </div>
            <div style={{ maxWidth:"80%", padding:"10px 14px", borderRadius:12, fontSize:13, lineHeight:1.6,
              background: msg.role === "user" ? `${T.accent}22` : T.card,
              border: `1px solid ${msg.role === "user" ? `${T.accent}44` : T.border}`,
              color: T.text, whiteSpace:"pre-wrap" }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, background:"rgba(99,102,241,0.2)", color:"#a5b4fc" }}>✦</div>
            <div style={{ padding:"10px 14px", borderRadius:12, background:T.card, border:`1px solid ${T.border}`, color:T.dim, fontSize:13 }}>
              <Spinner /> Analysing…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ display:"flex", gap:8, borderTop:`1px solid ${T.border}`, paddingTop:12 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder={run ? "Ask anything about this company's coverage…" : "No data yet — run a fetch first"}
          disabled={!run || !hasLLM || loading}
          style={{ flex:1, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 13px", fontSize:13, color:T.text, outline:"none" }}
        />
        <Btn onClick={() => handleSend()} disabled={!input.trim() || !run || !hasLLM || loading} variant="primary">
          {loading ? <Spinner /> : "Ask"}
        </Btn>
        {messages.length > 0 && (
          <Btn onClick={() => setMessages([])} variant="ghost" style={{ fontSize:11 }}>Clear</Btn>
        )}
      </div>
    </div>
  );
}

// ── SVG export generators (light-theme, self-contained for print/download) ────

function exportSentimentSVG(score, width = 420) {
  const pct = Math.min(100, Math.max(0, ((score + 1) / 2) * 100));
  const x   = Math.round((pct / 100) * width);
  const clr = score > 0.2 ? "#16a34a" : score < -0.2 ? "#dc2626" : "#d97706";
  const lbl = score > 0.2 ? "Positive" : score < -0.2 ? "Negative" : "Neutral";
  const val = (score >= 0 ? "+" : "") + score.toFixed(2);
  const id  = `sg${Math.abs(Math.round(score * 100))}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="56">
  <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0%" stop-color="#ef4444"/><stop offset="50%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#22c55e"/></linearGradient></defs>
  <rect x="0" y="14" width="${width}" height="12" rx="6" fill="url(#${id})"/>
  <circle cx="${x}" cy="20" r="9" fill="${clr}" stroke="white" stroke-width="2.5"/>
  <text x="${Math.max(36, Math.min(x, width - 60))}" y="42" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" fill="${clr}" font-weight="bold">${val} — ${lbl}</text>
  <text x="2"          y="56" font-size="9" font-family="Arial,sans-serif" fill="#9ca3af">Negative</text>
  <text x="${width/2}" y="56" text-anchor="middle" font-size="9" font-family="Arial,sans-serif" fill="#9ca3af">Neutral</text>
  <text x="${width-2}" y="56" text-anchor="end"    font-size="9" font-family="Arial,sans-serif" fill="#9ca3af">Positive</text>
</svg>`;
}

function exportBarsSVG(rows, width = 380) {
  if (!rows.length) return "";
  const rowH = 24, labelW = 140, numW = 50;
  const barMaxW = width - labelW - numW - 12;
  const maxVal  = Math.max(...rows.map(r => r.value || 0), 1);
  const total   = rows.reduce((s, r) => s + (r.value || 0), 0);
  const svgH    = rows.length * rowH + 4;
  const inner   = rows.map((r, i) => {
    const barW = Math.max(2, ((r.value || 0) / maxVal) * barMaxW);
    const pct  = total > 0 ? `${Math.round((r.value || 0) / total * 100)}%` : "";
    const y    = i * rowH + 2;
    return `<text x="0" y="${y + 14}" font-size="11" font-family="Arial,sans-serif" fill="#374151">${r.label}</text>
  <rect x="${labelW}" y="${y + 2}" width="${barW}" height="16" rx="4" fill="${r.color || "#818cf8"}"/>
  <text x="${labelW + barW + 5}" y="${y + 14}" font-size="10" font-family="Arial,sans-serif" fill="#6b7280">${r.value} ${pct}</text>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgH}">\n  ${inner}\n</svg>`;
}

function exportDonutSVG(data, size = 160, thickness = 28) {
  const cx = size / 2, cy = size / 2, r = (size - thickness) / 2;
  const C  = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (!total) return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${thickness}"/></svg>`;
  let cum = 0;
  const segs = data.map(d => {
    const dash = ((d.value || 0) / total) * C;
    const s = { ...d, dash, gap: C - dash, start: cum };
    cum += dash;
    return s;
  });
  const circles = segs.filter(s => s.value > 0).map(s =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness - 2}" stroke-dasharray="${s.dash.toFixed(1)} ${s.gap.toFixed(1)}" stroke-dashoffset="${(C - s.start).toFixed(1)}"/>`
  ).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="transform:rotate(-90deg)">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${thickness}"/>
  ${circles}
</svg>`;
}

function exportSparklineSVG(runs, width = 200, height = 56) {
  if (!runs || runs.length < 2) return "";
  const pts  = [...runs].reverse();
  const step = width / (pts.length - 1);
  const points = pts.map((r, i) => {
    const s = r.sentimentScore || 0;
    const y = height / 2 - s * (height / 2 - 6);
    return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4,3"/>
  <polyline points="${points}" fill="none" stroke="#818cf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

function exportSovDonutsHTML(sovColored, totalMedia, totalSocial) {
  if (!sovColored.length) return "";
  const hasSocial = sovColored.some(r => r.socialCount > 0);
  const pressData  = sovColored.map(r => ({ value: r.mediaCount  || 0, color: r.color, name: r.name, isBase: r.isBase }));
  const socialData = sovColored.map(r => ({ value: r.socialCount || 0, color: r.color, name: r.name, isBase: r.isBase }));
  const legend = (data, total) => data.filter(d => d.value > 0).map(d =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
       <div style="width:10px;height:10px;border-radius:2px;background:${d.color};flex-shrink:0"></div>
       <span style="font-size:11px;font-weight:${d.isBase?'700':'400'};color:#374151;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}${d.isBase?' ★':''}</span>
       <span style="font-size:11px;color:#6b7280;margin-left:auto">${d.value}</span>
       <span style="font-size:10px;color:#9ca3af;width:32px;text-align:right">${total > 0 ? Math.round(d.value/total*100)+'%' : '—'}</span>
     </div>`
  ).join("");
  const colStyle = `style="flex:1;min-width:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px"`;
  let html = `<div style="display:flex;gap:16px;margin:16px 0">
  <div ${colStyle}>
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Press Share of Voice</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="position:relative;flex-shrink:0">${exportDonutSVG(pressData, 120, 22)}<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#111">${totalMedia}</div></div>
      <div style="flex:1;min-width:0">${legend(pressData, totalMedia)}</div>
    </div>
  </div>`;
  if (hasSocial) {
    html += `
  <div ${colStyle}>
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Social Share of Voice</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="position:relative;flex-shrink:0">${exportDonutSVG(socialData, 120, 22)}<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#111">${totalSocial}</div></div>
      <div style="flex:1;min-width:0">${legend(socialData, totalSocial)}</div>
    </div>
  </div>`;
  }
  return html + "</div>";
}

// ── Company Detail — Briefing tab ─────────────────────────────────────────────

// ── Briefing formatted text renderer ─────────────────────────────────────────

function BriefingText({ text }) {
  if (!text) return null;
  return (
    <div>
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} style={{ height:6 }} />;
        // Numbered section headers (e.g. "1. COVERAGE OVERVIEW") or ALL-CAPS lines
        if (/^\d+\.\s+[A-Z]/.test(t) || /^[A-Z][A-Z &\/().,\-]{6,}$/.test(t)) {
          return <div key={i} style={{ fontSize:13, fontWeight:800, color:T.text, marginTop:18, marginBottom:4, paddingBottom:5, borderBottom:`1px solid ${T.border}`, letterSpacing:"0.02em" }}>{t}</div>;
        }
        // Subheadings with colon
        if (/^[A-Z][A-Za-z ]{2,30}:$/.test(t)) {
          return <div key={i} style={{ fontSize:12, fontWeight:700, color:T.text, marginTop:10, marginBottom:2 }}>{t}</div>;
        }
        // Bullets
        if (t.startsWith('•') || t.startsWith('-') || t.startsWith('*')) {
          return (
            <div key={i} style={{ display:"flex", gap:8, marginTop:3 }}>
              <span style={{ color:T.accent, flexShrink:0, fontWeight:700 }}>•</span>
              <span style={{ fontSize:12, color:T.dim, lineHeight:1.68 }}>{t.replace(/^[•\-*]\s*/, "")}</span>
            </div>
          );
        }
        return <p key={i} style={{ fontSize:12, color:T.dim, lineHeight:1.72, margin:"3px 0" }}>{t}</p>;
      })}
    </div>
  );
}

// ── Briefing data visualisation ───────────────────────────────────────────────

function BriefingCharts({ company, persona = "exec" }) {
  const run = company.runs?.[0];
  if (!run) return null;

  const media   = run.mediaResults  || [];
  const social  = run.socialResults || [];
  const sent    = run.sentimentScore || 0;
  const sentPct = Math.min(100, Math.max(0, (sent + 1) / 2 * 100));
  const sentColor = sent > 0.2 ? "#22c55e" : sent < -0.2 ? "#ef4444" : "#f59e0b";
  const sentLabel = sent > 0.2 ? "Positive" : sent < -0.2 ? "Negative" : "Neutral";

  const themes  = detectThemes(media);
  const maxTheme = Math.max(...themes.map(t => t.articles.length), 1);

  const t1 = media.filter(m => m.tier === 1).length;
  const t2 = media.filter(m => m.tier === 2).length;
  const t3 = media.filter(m => m.tier === 3).length;
  const maxTier = Math.max(t1, t2, t3, 1);

  const byPlat = {};
  social.forEach(s => { byPlat[s.platform] = (byPlat[s.platform] || 0) + 1; });
  const platforms = Object.entries(byPlat).sort((a, b) => b[1] - a[1]);
  const maxPlat = Math.max(...platforms.map(p => p[1]), 1);

  const sov = company.sovRun;
  const sovColored = (() => {
    if (!sov?.results) return [];
    let peer = 1;
    return [...sov.results]
      .sort((a,b) => (b.mediaCount||0)-(a.mediaCount||0))
      .map(r => ({ ...r, color: r.isBase ? SOV_PALETTE[0] : SOV_PALETTE[peer++ % SOV_PALETTE.length] }));
  })();
  const maxSov = Math.max(...sovColored.map(r => r.mediaCount||0), 1);
  const sovTotal = sovColored.reduce((s,r) => s+(r.mediaCount||0), 0);

  const Card = ({ title, children, style }) => (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"14px 16px", ...style }}>
      <div style={{ fontSize:10, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );

  const MiniBar = ({ label, count, max, color, labelWidth = 110 }) => (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
      <div style={{ width:labelWidth, fontSize:11, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flexShrink:0 }}>{label}</div>
      <div style={{ flex:1, height:7, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.max(2, count/max*100)}%`, background:color, borderRadius:4 }} />
      </div>
      <div style={{ width:26, textAlign:"right", fontSize:11, color:T.dim, flexShrink:0 }}>{count}</div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:4 }}>
      {/* Row 1: Sentiment + Tier + History */}
      <div style={{ display:"grid", gridTemplateColumns:`1fr 180px${company.runs?.length > 1 ? " 160px" : ""}`, gap:12 }}>
        {/* Sentiment meter */}
        <Card title="Overall Sentiment">
          <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:28, fontWeight:800, color:sentColor, letterSpacing:"-0.03em" }}>{sent >= 0 ? "+" : ""}{sent.toFixed(2)}</span>
            <span style={{ fontSize:12, color:sentColor, fontWeight:600 }}>{sentLabel}</span>
            <span style={{ fontSize:11, color:T.faint, marginLeft:"auto" }}>{media.length} articles · {social.length} posts</span>
          </div>
          <div style={{ position:"relative", height:10, borderRadius:5, background:"linear-gradient(to right, #ef4444 0%, #f59e0b 50%, #22c55e 100%)" }}>
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"50%", transform:"translate(-50%,-50%)", width:18, height:18, borderRadius:"50%", background:sentColor, border:`2.5px solid ${T.bg}`, boxShadow:"0 1px 6px rgba(0,0,0,0.5)" }} />
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"calc(100% + 5px)", transform:"translateX(-50%)", fontSize:9, fontWeight:700, color:sentColor, whiteSpace:"nowrap", background:T.bg, padding:"1px 4px", borderRadius:3, border:`1px solid ${sentColor}40` }}>{sent >= 0 ? "+" : ""}{sent.toFixed(2)}</div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:T.faint, marginTop:18 }}>
            <span>Negative</span><span>Neutral</span><span>Positive</span>
          </div>
          {run.keyDrivers?.length > 0 && (
            <div style={{ marginTop:10, display:"flex", gap:5, flexWrap:"wrap" }}>
              {run.keyDrivers.map((d, i) => <Tag key={i} label={d} color={T.accent} />)}
            </div>
          )}
        </Card>

        {/* Tier split */}
        <Card title="Outlet Tiers">
          {[["Tier 1", t1, "#818cf8"], ["Tier 2", t2, "#60a5fa"], ["Tier 3", t3, "#94a3b8"]].map(([label, count, color]) => (
            <MiniBar key={label} label={label} count={count} max={maxTier} color={color} labelWidth={46} />
          ))}
        </Card>

        {/* Sentiment history sparkline */}
        {company.runs?.length > 1 && (
          <Card title="Trend">
            <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:52 }}>
              {[...company.runs].reverse().map((r, i) => {
                const s = r.sentimentScore || 0;
                const h = Math.round(Math.abs(s) * 44 + 8);
                const c = s > 0.2 ? "#22c55e" : s < -0.2 ? "#ef4444" : "#f59e0b";
                return (
                  <div key={i} title={`${r.ranAt?.slice(0,10)}: ${s >= 0 ? "+" : ""}${s.toFixed(2)}`}
                    style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <div style={{ width:"100%", height:h, background:c, borderRadius:3, opacity:0.85 }} />
                    <div style={{ fontSize:8, color:T.faint, whiteSpace:"nowrap" }}>{r.ranAt?.slice(5,10)||""}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Row 2: Coverage Themes (full width if prominent) */}
      {themes.length > 0 && (
        <Card title={`Coverage Themes (${themes.length} detected across ${media.length} articles)`}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 24px" }}>
            {themes.slice(0, 8).map(t => (
              <MiniBar key={t.id} label={t.label} count={t.articles.length} max={maxTheme} color={T.accent} labelWidth={150} />
            ))}
          </div>
        </Card>
      )}

      {/* Row 3: Social + SOV mini */}
      {(platforms.length > 0 || sovColored.length > 0) && (
        <div style={{ display:"grid", gridTemplateColumns:platforms.length > 0 && sovColored.length > 0 ? "1fr 1fr" : "1fr", gap:12 }}>
          {platforms.length > 0 && (
            <Card title="Social Platforms">
              {platforms.map(([plat, count]) => {
                const meta = PLAT[plat] || { color:T.dim, icon:"◈" };
                return <MiniBar key={plat} label={`${meta.icon} ${plat}`} count={count} max={maxPlat} color={meta.color} labelWidth={90} />;
              })}
            </Card>
          )}
          {sovColored.length > 0 && (
            <Card title={`Press Share of Voice (${sov.ranAt?.slice(0,10)||"last run"})`}>
              <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                <DonutChart size={80} thickness={16}
                  data={sovColored.map(r => ({ value:r.mediaCount||0, color:r.color }))}
                  centerLabel={<span style={{ fontSize:9, color:T.faint }}>{sovTotal}</span>}
                />
                <div style={{ flex:1, minWidth:0 }}>
                  {sovColored.map(r => (
                    <div key={r.name} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:r.color, flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:11, fontWeight:r.isBase?700:400, color:r.isBase?T.text:T.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}</div>
                      <span style={{ fontSize:10, color:T.dim, flexShrink:0 }}>{r.mediaCount||0}</span>
                      <span style={{ fontSize:9, color:T.faint, width:30, textAlign:"right", flexShrink:0 }}>{sovTotal>0?`${Math.round((r.mediaCount||0)/sovTotal*100)}%`:"—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Row 4 (report persona only): Full SOV section with large donuts + sentiment comparison */}
      {persona === "report" && sovColored.length > 0 && (() => {
        const hasSoc = sovColored.some(r => r.socialCount > 0);
        return (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:14 }}>
              Full Share of Voice Analysis — {sov.ranAt?.slice(0,10)||"last run"}
            </div>

            {/* Big donuts */}
            <div style={{ display:"grid", gridTemplateColumns: hasSoc ? "1fr 1fr" : "1fr", gap:16, marginBottom:20 }}>
              {/* Press SOV */}
              <div style={{ background:T.ghost, borderRadius:10, padding:"14px 16px" }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>Press Share of Voice</div>
                <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                  <DonutChart data={sovColored.map(r=>({value:r.mediaCount||0,color:r.color}))}
                    centerLabel={<div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:T.text}}>{sovTotal}</div><div style={{fontSize:8,color:T.faint}}>articles</div></div>} />
                  <div style={{ flex:1, minWidth:0 }}>
                    {sovColored.map(r => (
                      <div key={r.name} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                        <span style={{ fontSize:11, fontWeight:r.isBase?700:400, color:r.isBase?T.text:T.dim, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}{r.isBase?" ★":""}</span>
                        <span style={{ fontSize:11, color:T.dim, flexShrink:0 }}>{r.mediaCount||0}</span>
                        <span style={{ fontSize:10, color:T.faint, width:34, textAlign:"right", flexShrink:0 }}>{sovTotal>0?`${Math.round((r.mediaCount||0)/sovTotal*100)}%`:"—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Social SOV */}
              {hasSoc && (() => {
                const socTotal = sovColored.reduce((s,r)=>s+(r.socialCount||0),0);
                return (
                  <div style={{ background:T.ghost, borderRadius:10, padding:"14px 16px" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>Social Share of Voice</div>
                    <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                      <DonutChart data={sovColored.map(r=>({value:r.socialCount||0,color:r.color}))}
                        centerLabel={<div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:800,color:T.text}}>{socTotal}</div><div style={{fontSize:8,color:T.faint}}>posts</div></div>} />
                      <div style={{ flex:1, minWidth:0 }}>
                        {[...sovColored].sort((a,b)=>(b.socialCount||0)-(a.socialCount||0)).map(r => (
                          <div key={r.name} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7 }}>
                            <div style={{ width:10, height:10, borderRadius:2, background:r.color, flexShrink:0 }} />
                            <span style={{ fontSize:11, fontWeight:r.isBase?700:400, color:r.isBase?T.text:T.dim, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}{r.isBase?" ★":""}</span>
                            <span style={{ fontSize:11, color:T.dim, flexShrink:0 }}>{r.socialCount||0}</span>
                            <span style={{ fontSize:10, color:T.faint, width:34, textAlign:"right", flexShrink:0 }}>{socTotal>0?`${Math.round((r.socialCount||0)/socTotal*100)}%`:"—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Sentiment comparison */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>Sentiment Comparison</div>
              {[...sovColored].sort((a,b)=>(b.sentiment||0)-(a.sentiment||0)).map(r => {
                const s = r.sentiment || 0;
                const pct = Math.abs(s) * 50;
                const isPos = s >= 0;
                return (
                  <div key={r.name} style={{ display:"grid", gridTemplateColumns:"140px 1fr 80px", gap:8, alignItems:"center", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:r.color, flexShrink:0 }} />
                      <span style={{ fontSize:11, fontWeight:r.isBase?700:400, color:r.isBase?T.text:T.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</span>
                    </div>
                    <div style={{ position:"relative", height:8, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
                      <div style={{ position:"absolute", top:0, bottom:0, width:"1px", left:"50%", background:T.border }} />
                      <div style={{ position:"absolute", top:1, bottom:1, borderRadius:3, background:r.color, left:isPos?"50%":`${50-pct}%`, width:`${pct}%`, minWidth:s!==0?3:0 }} />
                    </div>
                    <SentimentChip score={s} />
                  </div>
                );
              })}
            </div>

            {/* Competitive matrix table */}
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${T.border}` }}>
                    {["Company","Press","Press %","Social","Sentiment","Rank"].map(h => (
                      <th key={h} style={{ textAlign:h==="Company"?"left":"right", padding:"5px 8px", fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sovColored.map((r, i) => (
                    <tr key={r.name} style={{ borderBottom:`1px solid ${T.border}18` }}>
                      <td style={{ padding:"7px 8px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:r.color }} />
                          <span style={{ fontWeight:r.isBase?700:400, color:r.isBase?T.text:T.dim }}>{r.name}</span>
                          {r.isBase && <span style={{ fontSize:9, padding:"1px 4px", borderRadius:3, background:`${T.accent}20`, color:T.accent }}>YOU</span>}
                        </div>
                      </td>
                      <td style={{ textAlign:"right", padding:"7px 8px", fontWeight:600, color:T.text }}>{r.mediaCount||0}</td>
                      <td style={{ textAlign:"right", padding:"7px 8px", color:T.dim }}>{sovTotal>0?`${Math.round((r.mediaCount||0)/sovTotal*100)}%`:"—"}</td>
                      <td style={{ textAlign:"right", padding:"7px 8px", color:T.text }}>{r.socialCount||0}</td>
                      <td style={{ textAlign:"right", padding:"7px 8px" }}><SentimentChip score={r.sentiment||0} /></td>
                      <td style={{ textAlign:"right", padding:"7px 8px", color:T.faint, fontSize:10 }}>#{i+1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sov.aiSummary && (
              <div style={{ marginTop:16, paddingTop:16, borderTop:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>AI Competitive Analysis</div>
                <div style={{ fontSize:12, color:T.dim, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{sov.aiSummary}</div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Company Detail — Briefing tab ─────────────────────────────────────────────

function BriefingTab({ company, settings, onUpdate, toast }) {
  const [persona, setPersona] = useState("exec");
  const [briefing, setBriefing] = useState("");
  const [loading, setLoading] = useState(false);
  const [contactEmail, setContactEmail] = useState(company.contact_email || "");

  const personas = [
    { id:"exec",   label:"Executive",          desc:"CEO/investor lens — strategic, concise" },
    { id:"tech",   label:"Technical",           desc:"Product & engineering focus" },
    { id:"comms",  label:"LP Update",           desc:"Formal tone for LP communications" },
    { id:"report", label:"Portfolio Co. Report", desc:"Coverage & sentiment report for the company" },
  ];

  const saveEmail = () => {
    onUpdate({ ...company, contact_email: contactEmail });
    toast("Contact email saved", "success");
  };

  const handleGenerate = async () => {
    setLoading(true);
    setBriefing("");
    try {
      const result = await generateBriefing(company, persona, settings.apiKeys);
      setBriefing(result);
    } catch (e) { toast(e.message, "error"); }
    setLoading(false);
  };

  // ── Rich download: generates clean white HTML with embedded SVG charts ───────
  const handleDownload = () => {
    if (!briefing) return;
    const run  = company.runs?.[0];
    const sov  = company.sovRun;
    const sent = run?.sentimentScore || 0;
    const media  = run?.mediaResults  || [];
    const social = run?.socialResults || [];
    const themes = run ? detectThemes(media) : [];

    // Build SOV colored data
    const sovColored = (() => {
      if (!sov?.results) return [];
      let peer = 1;
      return [...sov.results].sort((a,b)=>(b.mediaCount||0)-(a.mediaCount||0))
        .map(r => ({ ...r, color: r.isBase ? SOV_PALETTE[0] : SOV_PALETTE[peer++ % SOV_PALETTE.length] }));
    })();
    const sovTotal  = sovColored.reduce((s,r)=>s+(r.mediaCount||0),0);
    const socTotal  = sovColored.reduce((s,r)=>s+(r.socialCount||0),0);

    const t1 = media.filter(m=>m.tier===1).length;
    const t2 = media.filter(m=>m.tier===2).length;
    const t3 = media.filter(m=>m.tier===3).length;
    const byPlat = {};
    social.forEach(s => { byPlat[s.platform]=(byPlat[s.platform]||0)+1; });

    // SVG charts
    const sentSVG = run ? exportSentimentSVG(sent) : "";
    const tierSVG = (t1||t2||t3) ? exportBarsSVG([
      { label:"Tier 1 (flagship)", value:t1, color:"#818cf8" },
      { label:"Tier 2 (major)",    value:t2, color:"#60a5fa" },
      { label:"Tier 3 (trade)",    value:t3, color:"#94a3b8" },
    ]) : "";
    const themeSVG = themes.length ? exportBarsSVG(themes.slice(0,8).map(t=>({ label:t.label, value:t.articles.length, color:"#818cf8" }))) : "";
    const platSVG  = Object.keys(byPlat).length ? exportBarsSVG(Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([p,n])=>({ label:p, value:n, color: PLAT[p]?.color||"#818cf8" }))) : "";
    const sparkSVG = company.runs?.length > 1 ? exportSparklineSVG(company.runs) : "";
    const sovHTML  = sovColored.length ? exportSovDonutsHTML(sovColored, sovTotal, socTotal) : "";

    // SOV table HTML (for report persona)
    const sovTableHTML = (persona === "report" && sovColored.length) ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead><tr style="border-bottom:2px solid #e5e7eb">
          ${["Company","Press","Press SOV","Social","Sentiment","#"].map(h=>`<th style="text-align:${h==="Company"?"left":"right"};padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${h}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${sovColored.map((r,i)=>`<tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:7px 8px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px"></span><strong style="color:${r.isBase?"#111":"#374151"}">${r.name}${r.isBase?" ★":""}</strong></td>
            <td style="text-align:right;padding:7px 8px;font-weight:600">${r.mediaCount||0}</td>
            <td style="text-align:right;padding:7px 8px;color:#6b7280">${sovTotal>0?Math.round((r.mediaCount||0)/sovTotal*100)+"%" : "—"}</td>
            <td style="text-align:right;padding:7px 8px">${r.socialCount||0}</td>
            <td style="text-align:right;padding:7px 8px"><span style="font-size:11px;font-weight:700;color:${r.sentiment>0.15?"#16a34a":r.sentiment<-0.15?"#dc2626":"#d97706"}">${(r.sentiment>=0?"+":"")}${(r.sentiment||0).toFixed(2)}</span></td>
            <td style="text-align:right;padding:7px 8px;color:#9ca3af">#${i+1}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : "";

    // Format briefing text to HTML
    const textHTML = briefing.split('\n').map(line => {
      const t = line.trim();
      if (!t) return "<div style='height:8px'></div>";
      if (/^\d+\.\s+[A-Z]/.test(t) || /^[A-Z][A-Z &\/().,\-]{6,}$/.test(t))
        return `<h2 style="font-size:14px;font-weight:800;color:#111;margin:22px 0 6px;padding-bottom:5px;border-bottom:1px solid #e5e7eb">${t}</h2>`;
      if (/^[A-Z][A-Za-z ]{2,30}:$/.test(t))
        return `<h3 style="font-size:13px;font-weight:700;color:#374151;margin:14px 0 4px">${t}</h3>`;
      if (t.startsWith('•') || t.startsWith('-') || t.startsWith('*'))
        return `<div style="display:flex;gap:8px;margin:3px 0"><span style="color:#818cf8;font-weight:700;flex-shrink:0">•</span><span style="font-size:12px;color:#374151;line-height:1.7">${t.replace(/^[•\-*]\s*/,"")}</span></div>`;
      return `<p style="font-size:12px;color:#374151;line-height:1.75;margin:3px 0">${t}</p>`;
    }).join("\n");

    const personaLabel = personas.find(p=>p.id===persona)?.label || "Briefing";
    const dateStr = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${persona === "report" ? `${company.name} - Radical Brand Intelligence Report` : `${company.name} — ${personaLabel}`}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 28px; color: #111; background: #fff; }
  @media print { body { margin: 20px; } .no-print { display: none; } }
  .section-label { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
  .chart-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  .chart-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .chart-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  svg text { paint-order: stroke fill; }
</style>
</head><body>

<!-- Report header -->
<div style="border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between">
    <div>
      <h1 style="font-size:24px;font-weight:900;margin:0;letter-spacing:-0.03em">${persona === "report" ? `${company.name} - Radical Brand Intelligence Report` : company.name}</h1>
      <p style="color:#6b7280;font-size:13px;margin:4px 0 0">${persona === "report" ? `Prepared by Radical Ventures · ${dateStr}` : `${personaLabel} · Prepared by Radical Ventures · ${dateStr}`}</p>
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af">
      ${run ? `${media.length} articles · ${social.length} posts` : "No run data"}
      ${run ? `<br>${run.fromDate||""} → ${run.ranAt?.slice(0,10)||""}` : ""}
    </div>
  </div>
</div>

<!-- Data visualisations -->
<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Coverage Data</h2>

  ${sentSVG ? `
  <div class="chart-card">
    <div class="section-label">Overall Sentiment</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="font-size:32px;font-weight:900;color:${sent>0.2?"#16a34a":sent<-0.2?"#dc2626":"#d97706"};letter-spacing:-0.04em">${sent>=0?"+":""}${sent.toFixed(2)}</div>
      <div style="flex:1">${sentSVG}${sparkSVG ? `<div style="margin-top:6px"><div class="section-label">Sentiment trend</div>${sparkSVG}</div>` : ""}</div>
    </div>
    ${run?.keyDrivers?.length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${run.keyDrivers.map(d=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-weight:600">${d}</span>`).join("")}</div>` : ""}
  </div>` : ""}

  ${(tierSVG || platSVG) ? `
  <div class="${tierSVG && platSVG ? "chart-grid-2" : ""}">
    ${tierSVG ? `<div class="chart-card"><div class="section-label">Outlet Tiers</div>${tierSVG}</div>` : ""}
    ${platSVG ? `<div class="chart-card"><div class="section-label">Social Platforms</div>${platSVG}</div>` : ""}
  </div>` : ""}

  ${themeSVG ? `
  <div class="chart-card">
    <div class="section-label">Coverage Themes (${themes.length} detected)</div>
    ${themeSVG}
  </div>` : ""}
</div>

${sovHTML || sovTableHTML ? `
<!-- Share of Voice -->
<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Share of Voice Analysis</h2>
  ${sovHTML}
  ${sovTableHTML ? `<div class="chart-card" style="margin-top:14px"><div class="section-label">Competitive Matrix</div>${sovTableHTML}</div>` : ""}
  ${sov?.aiSummary ? `<div class="chart-card" style="margin-top:14px"><div class="section-label">AI Competitive Analysis</div><p style="font-size:12px;color:#374151;line-height:1.75;white-space:pre-wrap;margin:0">${sov.aiSummary.replace(/</g,"&lt;")}</p></div>` : ""}
</div>
` : ""}

<!-- AI-generated text -->
<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">${personaLabel}</h2>
  ${textHTML}
</div>

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Generated by Radical Intelligence Platform · Radical Ventures · ${dateStr}
</div>

</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { toast("Pop-up blocked — allow pop-ups to use Download", "error"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  const handleEmail = () => {
    if (!briefing) return;
    const subject = encodeURIComponent(`${company.name} — ${personas.find(p=>p.id===persona)?.label}`);
    const body = encodeURIComponent(briefing.slice(0, 1800) + (briefing.length > 1800 ? "\n\n[Full report with charts available via Download]" : ""));
    const to = encodeURIComponent(contactEmail || "");
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Contact email (report persona) */}
      {persona === "report" && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"14px 18px" }}>
          <div style={{ fontSize:12, fontWeight:600, color:T.text, marginBottom:8 }}>Contact at {company.name}</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <Input value={contactEmail} onChange={setContactEmail} placeholder="name@company.com" style={{ flex:1 }} />
            <Btn variant="ghost" onClick={saveEmail} style={{ fontSize:11, whiteSpace:"nowrap" }}>Save</Btn>
          </div>
          {company.contact_email && contactEmail === company.contact_email && (
            <div style={{ fontSize:11, color:T.dim, marginTop:6 }}>Saved · used for email sharing</div>
          )}
        </div>
      )}

      {/* Persona selector */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {personas.map(p => (
          <button key={p.id} onClick={() => { setPersona(p.id); setBriefing(""); }}
            style={{ padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`1px solid ${persona===p.id ? T.accent+"80" : T.border}`, background:persona===p.id ? T.accentDim : "transparent", color:persona===p.id ? T.accent : T.dim, textAlign:"left" }}>
            <div>{p.label}</div>
            <div style={{ fontSize:10, fontWeight:400, opacity:0.7, marginTop:2 }}>{p.desc}</div>
          </button>
        ))}
      </div>

      <Btn onClick={handleGenerate} disabled={loading} variant="primary" style={{ width:"fit-content", padding:"8px 20px", fontSize:13 }}>
        {loading ? <><Spinner /> Generating…</> : "✦ Generate briefing"}
      </Btn>

      {/* Generated report output */}
      {briefing && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"22px 26px" }}>
          {/* Report header */}
          <div style={{ borderBottom:`1px solid ${T.border}`, paddingBottom:14, marginBottom:20 }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
              <div>
                <div style={{ fontSize:18, fontWeight:900, color:T.text, letterSpacing:"-0.02em" }}>{company.name}</div>
                <div style={{ fontSize:11, color:T.faint, marginTop:3 }}>{personas.find(p=>p.id===persona)?.label} · Radical Ventures · {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
              </div>
              <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                <Btn variant="ghost" onClick={handleDownload} style={{ fontSize:11 }}>⬇ Download</Btn>
                <Btn variant="ghost" onClick={handleEmail}    style={{ fontSize:11 }}>✉ Email</Btn>
              </div>
            </div>
          </div>

          {/* Inline charts (always shown in report output) */}
          <div style={{ marginBottom:20 }}>
            <BriefingCharts company={company} persona={persona} />
          </div>

          {/* AI text — formatted */}
          <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:18 }}>
            <div style={{ fontSize:10, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:14 }}>
              {personas.find(p=>p.id===persona)?.label}
            </div>
            <BriefingText text={briefing} />
          </div>
        </div>
      )}

      {/* Empty state / context charts */}
      {!briefing && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <BriefingCharts company={company} persona={persona} />
          {!loading && (
            <div style={{ textAlign:"center", padding:"20px 0", color:T.faint, fontSize:12 }}>
              {company.runs?.[0] ? "Select a persona above and generate a briefing" : "Run a data fetch first to enable briefings"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Company Detail ────────────────────────────────────────────────────────────

function CompanyDetail({ company, settings, onBack, onRun, onUpdate, onUpdateSettings, toast }) {
  const [tab, setTab] = useState("overview");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [dateRange, setDateRange] = useState(settings.dateRange || "30d");
  const [editingQuery, setEditingQuery] = useState(false);
  const [queryDraft, setQueryDraft] = useState(company.boolean_query || "");

  const run = company.runs?.[0];

  const handleRun = async () => {
    const { apiKeys, features } = settings;
    const hasNews    = features.newsEnabled !== false && !!apiKeys.newsapi;
    const hasTwitter = !!(features.twitterEnabled && apiKeys.twitter);
    const hasLegacy  = !!(apiKeys.yutori || apiKeys.data365);
    if (!hasNews && !hasTwitter && !hasLegacy) {
      toast("Configure API keys in Admin → API Keys", "error"); return;
    }
    setRunning(true);
    await bustCompanyCache(company.name);
    try {
      const result = await runCompany(company, { ...settings, dateRange }, setProgress);
      const updatedRuns = [result, ...(company.runs || [])].slice(0, 3);
      onUpdate({ ...company, runs: updatedRuns });
      // Track Twitter spend
      if (result.twitterCost > 0 && onUpdateSettings) {
        const monthKey = new Date().toISOString().slice(0, 7);
        const prev = settings.twitterSpend || {};
        onUpdateSettings({ ...settings, twitterSpend: { ...prev, [monthKey]: (prev[monthKey] || 0) + result.twitterCost } });
      }
      toast(`${result.mediaCount} articles · ${result.socialCount} social posts${result.twitterCost > 0 ? ` · ~$${result.twitterCost.toFixed(4)} Twitter` : ""}`, "success");
    } catch (e) { toast("Run failed: " + e.message, "error"); }
    setRunning(false);
    setProgress("");
  };

  const saveQuery = () => {
    onUpdate({ ...company, boolean_query: queryDraft, boolean_approved: true });
    setEditingQuery(false);
    bustCompanyCache(company.name);
  };

  const handleCompanyDownload = () => {
    if (!run) return;
    const dateStr = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
    const sent   = run.sentimentScore || 0;
    const media  = run.mediaResults  || [];
    const social = run.socialResults || [];
    const themes = detectThemes(media);
    const sov    = company.sovRun;

    const t1 = media.filter(m => m.tier === 1).length;
    const t2 = media.filter(m => m.tier === 2).length;
    const t3 = media.filter(m => m.tier === 3).length;
    const byPlat = {};
    social.forEach(s => { byPlat[s.platform] = (byPlat[s.platform] || 0) + 1; });

    const sentSVG  = exportSentimentSVG(sent);
    const tierSVG  = (t1||t2||t3) ? exportBarsSVG([
      { label:"Tier 1 (flagship)", value:t1, color:"#818cf8" },
      { label:"Tier 2 (major)",    value:t2, color:"#60a5fa" },
      { label:"Tier 3 (trade)",    value:t3, color:"#94a3b8" },
    ]) : "";
    const themeSVG = themes.length ? exportBarsSVG(themes.slice(0,8).map(t=>({ label:t.label, value:t.articles.length, color:"#818cf8" }))) : "";
    const platSVG  = Object.keys(byPlat).length ? exportBarsSVG(Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([p,n])=>({ label:p, value:n, color: PLAT[p]?.color||"#818cf8" }))) : "";
    const sparkSVG = company.runs?.length > 1 ? exportSparklineSVG(company.runs) : "";

    // SOV
    const sovColored = (() => {
      if (!sov?.results) return [];
      let peer = 1;
      return [...sov.results].sort((a,b)=>(b.mediaCount||0)-(a.mediaCount||0))
        .map(r => ({ ...r, color: r.isBase ? SOV_PALETTE[0] : SOV_PALETTE[peer++ % SOV_PALETTE.length] }));
    })();
    const sovTotal = sovColored.reduce((s,r)=>s+(r.mediaCount||0),0);
    const socTotal = sovColored.reduce((s,r)=>s+(r.socialCount||0),0);
    const sovHTML  = sovColored.length ? exportSovDonutsHTML(sovColored, sovTotal, socTotal) : "";
    const sovTableHTML = sovColored.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead><tr style="border-bottom:2px solid #e5e7eb">
          ${["Company","Press","Press SOV","Social","Sentiment","#"].map(h=>`<th style="text-align:${h==="Company"?"left":"right"};padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">${h}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${sovColored.map((r,i)=>`<tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:7px 8px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px"></span><strong style="color:${r.isBase?"#111":"#374151"}">${r.name}${r.isBase?" ★":""}</strong></td>
            <td style="text-align:right;padding:7px 8px;font-weight:600">${r.mediaCount||0}</td>
            <td style="text-align:right;padding:7px 8px;color:#6b7280">${sovTotal>0?Math.round((r.mediaCount||0)/sovTotal*100)+"%" : "—"}</td>
            <td style="text-align:right;padding:7px 8px">${r.socialCount||0}</td>
            <td style="text-align:right;padding:7px 8px"><span style="font-size:11px;font-weight:700;color:${r.sentiment>0.15?"#16a34a":r.sentiment<-0.15?"#dc2626":"#d97706"}">${(r.sentiment>=0?"+":"")}${(r.sentiment||0).toFixed(2)}</span></td>
            <td style="text-align:right;padding:7px 8px;color:#9ca3af">#${i+1}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : "";

    const topArticles = media.slice(0, 10);
    const articlesHTML = topArticles.map(a => `
      <div style="padding:10px 0;border-bottom:1px solid #f3f4f6">
        <div style="font-size:12px;font-weight:700;color:#111;margin-bottom:3px">${(a.title||"Untitled").replace(/</g,"&lt;")}</div>
        <div style="font-size:11px;color:#6b7280">${a.source?.name||a.source||""} ${a.publishedAt?"· "+a.publishedAt.slice(0,10):""} ${a.url?`· <a href="${a.url}" style="color:#818cf8">${a.url.replace(/^https?:\/\/(www\.)?/,"").split("/")[0]}</a>`:""}</div>
      </div>`).join("");

    const sentColor = sent > 0.2 ? "#16a34a" : sent < -0.2 ? "#dc2626" : "#d97706";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${company.name} - Radical Brand Intelligence Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 28px; color: #111; background: #fff; }
  @media print { body { margin: 20px; } }
  .section-label { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
  .chart-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  .chart-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  svg text { paint-order: stroke fill; }
</style>
</head><body>

<div style="border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between">
    <div>
      <h1 style="font-size:24px;font-weight:900;margin:0;letter-spacing:-0.03em">${company.name} - Radical Brand Intelligence Report</h1>
      <p style="color:#6b7280;font-size:13px;margin:4px 0 0">Prepared by Radical Ventures · ${dateStr}</p>
      ${company.description ? `<p style="color:#374151;font-size:12px;margin:6px 0 0">${company.description.replace(/</g,"&lt;")}</p>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af">
      ${media.length} articles · ${social.length} posts<br>
      ${run.fromDate||""} → ${run.ranAt?.slice(0,10)||""}
    </div>
  </div>
  ${(company.categories||[]).length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
    ${(company.categories||[]).map(c=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-weight:600">${c}</span>`).join("")}
  </div>` : ""}
</div>

<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Coverage Data</h2>

  ${sentSVG ? `<div class="chart-card">
    <div class="section-label">Overall Sentiment</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="font-size:32px;font-weight:900;color:${sentColor};letter-spacing:-0.04em">${sent>=0?"+":""}${sent.toFixed(2)}</div>
      <div style="flex:1">${sentSVG}${sparkSVG?`<div style="margin-top:6px"><div class="section-label">Sentiment trend</div>${sparkSVG}</div>`:""}</div>
    </div>
    ${run.keyDrivers?.length?`<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${run.keyDrivers.map(d=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-weight:600">${d}</span>`).join("")}</div>`:""}
  </div>` : ""}

  ${(tierSVG||platSVG) ? `<div class="${tierSVG&&platSVG?"chart-grid-2":""}">
    ${tierSVG?`<div class="chart-card"><div class="section-label">Outlet Tiers</div>${tierSVG}</div>`:""}
    ${platSVG?`<div class="chart-card"><div class="section-label">Social Platforms</div>${platSVG}</div>`:""}
  </div>` : ""}

  ${themeSVG ? `<div class="chart-card">
    <div class="section-label">Coverage Themes (${themes.length} detected)</div>
    ${themeSVG}
  </div>` : ""}
</div>

${sovHTML||sovTableHTML ? `<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Share of Voice Analysis</h2>
  ${sovHTML}
  ${sovTableHTML?`<div class="chart-card" style="margin-top:14px"><div class="section-label">Competitive Matrix</div>${sovTableHTML}</div>`:""}
  ${sov?.aiSummary?`<div class="chart-card" style="margin-top:14px"><div class="section-label">AI Competitive Analysis</div><p style="font-size:12px;color:#374151;line-height:1.75;white-space:pre-wrap;margin:0">${sov.aiSummary.replace(/</g,"&lt;")}</p></div>`:""}
</div>` : ""}

${articlesHTML ? `<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Top Articles</h2>
  <div class="chart-card" style="padding:0 18px">${articlesHTML}</div>
</div>` : ""}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Generated by Radical Intelligence Platform · Radical Ventures · ${dateStr}
</div>

</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { toast("Pop-up blocked — allow pop-ups to use Download", "error"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  const tabs = [
    { id:"overview", label:"Overview" },
    { id:"sov",      label:"Share of Voice" },
    { id:"briefing", label:"AI Briefing" },
    { id:"ask",      label:"✦ Ask AI" },
  ];

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200, margin:"0 auto" }}>
      {/* Back */}
      <button onClick={onBack} style={{ background:"none", border:"none", color:T.dim, cursor:"pointer", fontSize:12, marginBottom:16, padding:0, display:"flex", alignItems:"center", gap:4 }}>← Portfolio</button>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, gap:16, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
            <h1 style={{ margin:0, fontSize:24, fontWeight:800, color:T.text, letterSpacing:"-0.02em" }}>{company.name}</h1>
            <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }}>
              <span style={{ fontSize:11, color:company.enabled!==false ? "#4ade80" : T.faint }}>{company.enabled!==false ? "● Monitoring on" : "○ Paused"}</span>
              <input type="checkbox" checked={company.enabled!==false} onChange={e => onUpdate({ ...company, enabled: e.target.checked })} style={{ cursor:"pointer" }} />
            </label>
          </div>
          <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
            {(company.categories || []).map(cat => <Tag key={cat} label={cat} color={CAT_COLOR[cat] || "#6b7280"} />)}
            {company.website && <a href={`https://${company.website}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:T.accent, textDecoration:"none" }}>{company.website} ↗</a>}
          </div>
          <div style={{ fontSize:12, color:T.dim, lineHeight:1.5 }}>{company.description}</div>
        </div>

        {/* Run controls */}
        <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
            {/* Source toggles */}
            {[
              { key:"newsEnabled",    label:"News",    color:"#60a5fa", default:true },
              { key:"twitterEnabled", label:"Twitter", color:"#1d9bf0" },
            ].map(s => {
              const on = settings.features?.[s.key] ?? s.default ?? false;
              return (
                <button key={s.key}
                  onClick={() => onUpdateSettings && onUpdateSettings({ ...settings, features: { ...settings.features, [s.key]: !on } })}
                  title={`${on ? "Disable" : "Enable"} ${s.label}`}
                  style={{ padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:700, cursor:"pointer", border:`1px solid ${on ? s.color+"60" : T.border}`, background:on ? `${s.color}18` : "transparent", color:on ? s.color : T.faint }}>
                  {on ? "●" : "○"} {s.label}
                </button>
              );
            })}
            <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"6px 10px", fontSize:12, color:T.text, outline:"none" }}>
              {DATE_RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            {run && (
              <Btn onClick={handleCompanyDownload} variant="ghost" style={{ fontSize:11, padding:"6px 12px" }}>⬇ Download</Btn>
            )}
            <Btn onClick={handleRun} disabled={running} variant="primary" style={{ padding:"6px 16px", fontSize:13 }}>
              {running ? <><Spinner /> {progress || "Running…"}</> : "▶ Run Search"}
            </Btn>
          </div>
          {run && (
            <div style={{ fontSize:11, color:T.dim, textAlign:"right" }}>
              {run.mediaCount} articles · {run.socialCount} social · <SentimentChip score={run.sentimentScore || 0} /> · {ago(run.ranAt)}
            </div>
          )}
        </div>
      </div>

      {/* Boolean query */}
      <div style={{ background:T.card, border:`1px solid ${company.boolean_approved ? T.border : "#f59e0b40"}`, borderRadius:10, padding:"10px 14px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"space-between" }}>
          <div style={{ flex:1 }}>
            <span style={{ fontSize:10, color:T.dim }}>Search query </span>
            {!company.boolean_approved && <span style={{ fontSize:10, color:"#f59e0b", fontWeight:600 }}>⚠ Not reviewed</span>}
            {editingQuery ? (
              <div style={{ display:"flex", gap:6, marginTop:6 }}>
                <input value={queryDraft} onChange={e => setQueryDraft(e.target.value)} style={{ flex:1, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 9px", fontSize:11, color:T.text, outline:"none", fontFamily:"monospace" }} />
                <Btn onClick={saveQuery} variant="success" style={{ fontSize:11 }}>Save</Btn>
                <Btn onClick={() => { setQueryDraft(company.boolean_query || ""); setEditingQuery(false); }} variant="ghost" style={{ fontSize:11 }}>Cancel</Btn>
              </div>
            ) : (
              <span style={{ fontSize:11, color:T.text, fontFamily:"monospace", marginLeft:6 }}>{company.boolean_query}</span>
            )}
          </div>
          {!editingQuery && <Btn onClick={() => setEditingQuery(true)} variant="ghost" style={{ fontSize:10, padding:"3px 8px" }}>Edit</Btn>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, marginBottom:20, borderBottom:`1px solid ${T.border}`, paddingBottom:0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:"8px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:600, color:tab===t.id ? T.accent : T.dim, borderBottom:tab===t.id ? `2px solid ${T.accent}` : "2px solid transparent", marginBottom:-1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab company={company} run={run} />}
      {tab === "sov"      && <SOVTab company={company} settings={settings} onUpdate={onUpdate} toast={toast} />}
      {tab === "briefing" && <BriefingTab company={company} settings={settings} onUpdate={onUpdate} toast={toast} />}
      {tab === "ask"      && <AskAITab company={company} settings={settings} />}
    </div>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────

function Admin({ settings, outlets, companies, onUpdateSettings, onUpdateOutlets, onUpdateCompanies, toast }) {
  const [tab, setTab] = useState("keys");
  const [outletSearch, setOutletSearch] = useState("");
  const [outletTier, setOutletTier] = useState("All");

  const { apiKeys, features } = settings;

  const setKey = (k, v) => onUpdateSettings({ ...settings, apiKeys: { ...apiKeys, [k]: v } });
  const setFeature = (k, v) => onUpdateSettings({ ...settings, features: { ...features, [k]: v } });
  const setDateRange = v => onUpdateSettings({ ...settings, dateRange: v });

  const monthKey = new Date().toISOString().slice(0, 7);
  const twitterSpend = settings.twitterSpend || {};
  const twitterSpentThisMonth = twitterSpend[monthKey] || 0;
  const twitterBudget = features.twitterBudgetMonthly || 10;
  const twitterBudgetPct = Math.min(100, (twitterSpentThisMonth / twitterBudget) * 100);
  const twitterCreditBalance = settings.twitterCreditBalance ?? 20;
  const twitterAllTimeSpend = Object.values(twitterSpend).reduce((s, v) => s + v, 0);
  const twitterCreditsRemaining = Math.max(0, twitterCreditBalance - twitterAllTimeSpend);
  const twitterCreditPct = twitterCreditBalance > 0 ? Math.min(100, (twitterAllTimeSpend / twitterCreditBalance) * 100) : 0;
  const twitterRunLog = settings.twitterRunLog || [];
  const costPerRun = (features.twitterMaxPages || 3) * 20 * 0.00015;
  const runsRemaining = twitterCreditsRemaining > 0 ? Math.floor(twitterCreditsRemaining / costPerRun) : 0;

  const API_KEYS_CONFIG = [
    { group:"News", keys:[
      { id:"newsapi", label:"NewsAPI", placeholder:"Enter NewsAPI key", note:"Primary news source — 150k+ publications. Free: 100 req/day. Paid: unlimited.", url:"https://newsapi.org", required:true },
    ]},
    { group:"LLM (sentiment & briefings)", keys:[
      { id:"gemini", label:"Google Gemini", placeholder:"AIzaSy…", note:"Public Gemini API from Google AI Studio.", url:"https://aistudio.google.com" },
      { id:"anthropic", label:"Anthropic Claude", placeholder:"sk-ant-…", note:"Fallback LLM for sentiment and briefings.", url:"https://console.anthropic.com" },
      { id:"cohere", label:"Cohere (Public)", placeholder:"your-cohere-key", note:"Public Cohere API.", url:"https://dashboard.cohere.com" },
      { id:"cohere_north_key", label:"Cohere North Key", placeholder:"your-north-key", note:"Radical's private Cohere deployment (IP-allowlisted).", url:"https://radical.cloud.cohere.com" },
    ]},
  ];

  const [twitterTestResult, setTwitterTestResult] = useState(null);
  const [twitterTesting, setTwitterTesting] = useState(false);

  const handleTwitterTest = async () => {
    const key = apiKeys.twitter;
    if (!key) { setTwitterTestResult({ ok: false, error: "No API key entered" }); return; }
    setTwitterTesting(true);
    setTwitterTestResult(null);
    try {
      const r = await fetch(`http://localhost:3001/twitter-test?key=${encodeURIComponent(key)}`);
      const d = await r.json();
      setTwitterTestResult(d);
    } catch (e) {
      setTwitterTestResult({ ok: false, error: `Proxy unreachable: ${e.message}. Restart the proxy (double-click START-MAC.command).` });
    }
    setTwitterTesting(false);
  };

  const filteredOutlets = useMemo(() => {
    let list = outlets;
    if (outletSearch) list = list.filter(o => (o.name || "").toLowerCase().includes(outletSearch.toLowerCase()));
    if (outletTier !== "All") list = list.filter(o => o.tier === parseInt(outletTier.slice(1)));
    return list;
  }, [outlets, outletSearch, outletTier]);

  const handleReset = () => {
    if (confirm("Reset ALL data including companies, runs, and API keys? This cannot be undone.")) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  };

  const handleExport = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { toast("No data to export", "error"); return; }
    // Strip run results to keep the file small — only keep config (companies list, boolean queries, competitors, settings)
    const state = JSON.parse(raw);
    const exportData = {
      ...state,
      companies: (state.companies || []).map(c => ({
        ...c,
        runs: (c.runs || []).map((r, i) => i === 0
          ? { ...r, mediaResults: [], socialResults: [] }   // keep metadata, drop results
          : { ranAt: r.ranAt, mediaCount: r.mediaCount, socialCount: r.socialCount, sentimentScore: r.sentimentScore }
        ),
        sovRun: c.sovRun ? { ...c.sovRun, results: c.sovRun.results || [] } : null,
      })),
      _exportedAt: new Date().toISOString(),
      _version: STORAGE_KEY,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radical-data-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Data exported — save this file to back up your configuration", "success");
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.companies || !Array.isArray(imported.companies)) {
          toast("Invalid file — missing companies array", "error"); return;
        }
        if (confirm(`Import data from ${file.name}? This will replace your current configuration.`)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
          window.location.reload();
        }
      } catch {
        toast("Could not parse file — make sure it's a valid Radical export", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const adminTabs = ["keys","features","outlets","data"];

  return (
    <div style={{ padding:"28px 32px", maxWidth:900, margin:"0 auto" }}>
      <div style={{ fontSize:22, fontWeight:800, color:T.text, marginBottom:20 }}>Admin</div>

      <div style={{ display:"flex", gap:2, marginBottom:24, borderBottom:`1px solid ${T.border}` }}>
        {adminTabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding:"8px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:12, fontWeight:600, color:tab===t ? T.accent : T.dim, borderBottom:tab===t ? `2px solid ${T.accent}` : "2px solid transparent", marginBottom:-1, textTransform:"capitalize" }}>
            {t === "keys" ? "API Keys" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "keys" && (
        <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
          {/* Vertex toggle */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text }}>Vertex AI (Gemini 2.5 Flash)</div>
                <div style={{ fontSize:11, color:T.dim, marginTop:3 }}>Service account embedded in proxy — no key needed. Highest priority LLM.</div>
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                <span style={{ fontSize:11, color:apiKeys.vertex_enabled !== false ? "#4ade80" : T.faint }}>{apiKeys.vertex_enabled !== false ? "Enabled" : "Disabled"}</span>
                <input type="checkbox" checked={apiKeys.vertex_enabled !== false} onChange={e => setKey("vertex_enabled", e.target.checked)} />
              </label>
            </div>
          </div>

          {/* Twitter / X */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Social — Twitter / X</div>
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:14 }}>
              {/* Key + enable row */}
              <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
                <div style={{ flex:"1 1 280px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:T.text }}>TwitterAPI.io</div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {apiKeys.twitter ? <span style={{ fontSize:10, color:"#4ade80", background:"rgba(34,197,94,0.1)", padding:"2px 8px", borderRadius:10 }}>● Connected</span>
                        : <span style={{ fontSize:10, color:T.faint, background:T.ghost, padding:"2px 8px", borderRadius:10 }}>○ Not set</span>}
                      <a href="https://twitterapi.io/dashboard" target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:T.accent, textDecoration:"none" }}>Get key ↗</a>
                    </div>
                  </div>
                  <input type="password" value={apiKeys.twitter || ""} onChange={e => setKey("twitter", e.target.value)} placeholder="Your twitterapi.io key"
                    style={{ width:"100%", background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 11px", fontSize:12, color:T.text, outline:"none", fontFamily:"monospace", boxSizing:"border-box" }}
                  />
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6, flexWrap:"wrap" }}>
                    <span style={{ fontSize:10, color:T.faint }}>$0.15 per 1,000 tweets · ~$0.003 per page</span>
                    <Btn onClick={handleTwitterTest} disabled={twitterTesting} variant="ghost" style={{ fontSize:10, padding:"2px 8px" }}>
                      {twitterTesting ? <><Spinner /> Testing…</> : "Test connection"}
                    </Btn>
                  </div>
                  {twitterTestResult && (
                    <div style={{ marginTop:8, padding:"8px 12px", borderRadius:8, background: twitterTestResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border:`1px solid ${twitterTestResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, fontSize:11 }}>
                      {twitterTestResult.ok ? (
                        <>
                          <span style={{ color:"#4ade80", fontWeight:700 }}>✓ Connected</span>
                          <span style={{ color:T.dim }}> · {twitterTestResult.tweetCount} tweets returned</span>
                          {twitterTestResult.sample && <div style={{ color:T.faint, marginTop:4, fontStyle:"italic" }}>"{twitterTestResult.sample}…"</div>}
                        </>
                      ) : (
                        <>
                          <span style={{ color:"#f87171", fontWeight:700 }}>✗ Failed</span>
                          <span style={{ color:T.dim }}> · {twitterTestResult.error || `HTTP ${twitterTestResult.status}`}</span>
                          {twitterTestResult.rawBody && <div style={{ color:T.faint, marginTop:4, fontFamily:"monospace", fontSize:10 }}>{twitterTestResult.rawBody}</div>}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {/* Enable toggle */}
                <label style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"pointer", paddingTop:4 }}>
                  <span style={{ fontSize:10, color:T.dim }}>Enabled</span>
                  <span style={{ fontSize:11, fontWeight:700, color:features.twitterEnabled ? "#4ade80" : T.faint }}>{features.twitterEnabled ? "On" : "Off"}</span>
                  <input type="checkbox" checked={!!features.twitterEnabled} onChange={e => setFeature("twitterEnabled", e.target.checked)} />
                </label>
              </div>

              {/* API Cost Tracker */}
              <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:14, display:"flex", flexDirection:"column", gap:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>API Cost Tracker</div>

                {/* Credit balance + all-time bar */}
                <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:10, padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                    <div>
                      <div style={{ fontSize:11, color:T.dim, marginBottom:3 }}>Credit balance loaded into account</div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:13, color:T.faint }}>$</span>
                        <input type="number" min="0" step="5" value={twitterCreditBalance}
                          onChange={e => onUpdateSettings({ ...settings, twitterCreditBalance: parseFloat(e.target.value) || 0 })}
                          style={{ width:80, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 8px", fontSize:13, fontWeight:700, color:T.text, outline:"none" }}
                        />
                        <span style={{ fontSize:11, color:T.faint }}>USD</span>
                        <a href="https://twitterapi.io/payment" target="_blank" rel="noopener noreferrer"
                          style={{ fontSize:10, color:T.accent, textDecoration:"none", marginLeft:4 }}>Top up ↗</a>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:T.dim }}>Estimated remaining</div>
                      <div style={{ fontSize:22, fontWeight:800, color: twitterCreditsRemaining < twitterCreditBalance * 0.2 ? "#f87171" : twitterCreditsRemaining < twitterCreditBalance * 0.5 ? "#fbbf24" : "#4ade80" }}>
                        ${twitterCreditsRemaining.toFixed(2)}
                      </div>
                      <div style={{ fontSize:10, color:T.faint }}>~{runsRemaining.toLocaleString()} full runs left</div>
                    </div>
                  </div>
                  {/* All-time spend bar */}
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:10, color:T.dim }}>All-time spend: ${twitterAllTimeSpend.toFixed(4)}</span>
                      <span style={{ fontSize:10, color:T.dim }}>{twitterCreditPct.toFixed(1)}% of balance used</span>
                    </div>
                    <div style={{ height:5, borderRadius:3, background:T.ghost, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${twitterCreditPct}%`, background: twitterCreditPct > 80 ? "#f87171" : twitterCreditPct > 50 ? "#fbbf24" : "#4ade80", borderRadius:3, transition:"width 0.5s" }} />
                    </div>
                  </div>
                </div>

                {/* This month + controls row */}
                <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-start" }}>
                  <div style={{ flex:"1 1 180px" }}>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>This month ({monthKey})</div>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:12, fontWeight:700, color: twitterBudgetPct > 80 ? "#f87171" : twitterBudgetPct > 50 ? "#fbbf24" : T.text }}>${twitterSpentThisMonth.toFixed(4)}</span>
                      <span style={{ fontSize:11, color:T.dim }}>/ ${twitterBudget} cap</span>
                    </div>
                    <div style={{ height:5, borderRadius:3, background:T.ghost, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${twitterBudgetPct}%`, background: twitterBudgetPct > 80 ? "#f87171" : twitterBudgetPct > 50 ? "#fbbf24" : T.accent, borderRadius:3, transition:"width 0.4s" }} />
                    </div>
                    {twitterBudgetPct >= 100 && <div style={{ fontSize:10, color:"#f87171", marginTop:4 }}>Monthly cap reached — increase cap or wait until next month</div>}
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Monthly cap</div>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ fontSize:12, color:T.faint }}>$</span>
                      <input type="number" min="0" step="5" value={features.twitterBudgetMonthly ?? 10}
                        onChange={e => setFeature("twitterBudgetMonthly", parseFloat(e.target.value) || 0)}
                        style={{ width:65, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 8px", fontSize:12, color:T.text, outline:"none" }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Pages / run</div>
                    <input type="number" min="1" max="10" step="1" value={features.twitterMaxPages ?? 3}
                      onChange={e => setFeature("twitterMaxPages", parseInt(e.target.value) || 3)}
                      style={{ width:55, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 8px", fontSize:12, color:T.text, outline:"none" }}
                    />
                    <div style={{ fontSize:10, color:T.faint, marginTop:3 }}>~${costPerRun.toFixed(4)} / co.</div>
                  </div>
                </div>

                {/* Monthly spend history */}
                {Object.keys(twitterSpend).length > 0 && (
                  <div>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:6 }}>Monthly spend history</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                      {Object.entries(twitterSpend).sort((a,b) => b[0].localeCompare(a[0])).map(([month, spent]) => (
                        <div key={month} style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:11, color:T.dim, width:60, flexShrink:0 }}>{month}</span>
                          <div style={{ flex:1, height:4, borderRadius:2, background:T.ghost, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${Math.min(100,(spent/twitterBudget)*100)}%`, background:T.accent, borderRadius:2 }} />
                          </div>
                          <span style={{ fontSize:11, fontWeight:600, color:T.text, width:60, textAlign:"right", flexShrink:0 }}>${spent.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent run log */}
                {twitterRunLog.length > 0 && (
                  <div>
                    <div style={{ fontSize:11, color:T.dim, marginBottom:6 }}>Recent Twitter fetches</div>
                    <div style={{ maxHeight:160, overflowY:"auto", display:"flex", flexDirection:"column", gap:2 }}>
                      {twitterRunLog.slice(0,20).map((entry, i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:10, padding:"3px 0", borderBottom:`1px solid ${T.border}` }}>
                          <span style={{ color:T.faint, width:130, flexShrink:0 }}>{entry.at ? new Date(entry.at).toLocaleString() : "—"}</span>
                          <span style={{ color:T.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entry.company}</span>
                          <span style={{ color:T.dim, width:55, textAlign:"right", flexShrink:0 }}>{entry.tweets} tweets</span>
                          <span style={{ color:"#60a5fa", width:55, textAlign:"right", flexShrink:0 }}>${(entry.cost||0).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {API_KEYS_CONFIG.map(group => (
            <div key={group.group}>
              <div style={{ fontSize:12, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>{group.group}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {group.keys.map(k => (
                  <div key={k.id} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 18px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{k.label}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {apiKeys[k.id] ? <span style={{ fontSize:10, color:"#4ade80", background:"rgba(34,197,94,0.1)", padding:"2px 8px", borderRadius:10 }}>● Connected</span>
                          : <span style={{ fontSize:10, color:T.faint, background:T.ghost, padding:"2px 8px", borderRadius:10 }}>○ Not set</span>}
                        {k.url && <a href={k.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:T.accent, textDecoration:"none" }}>Get key ↗</a>}
                      </div>
                    </div>
                    <input type="password" value={apiKeys[k.id] || ""} onChange={e => setKey(k.id, e.target.value)} placeholder={k.placeholder}
                      style={{ width:"100%", background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 11px", fontSize:12, color:T.text, outline:"none", fontFamily:"monospace", boxSizing:"border-box" }}
                    />
                    {k.note && <div style={{ fontSize:10, color:T.faint, marginTop:6 }}>{k.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "features" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* Data sources — quick toggles */}
          <div style={{ fontSize:12, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:2 }}>Data sources</div>
          {[
            { id:"newsEnabled",    label:"News (NewsAPI)",       desc:`Fetch articles from 150k+ publications. Requires NewsAPI key.${apiKeys.newsapi ? "" : " — No key set."}` },
            { id:"twitterEnabled", label:"Twitter / X",          desc:`Fetch tweet mentions via TwitterAPI.io. $${((features.twitterMaxPages||3)*20*0.00015).toFixed(4)} per run (~${(features.twitterMaxPages||3)*20} tweets). Budget: $${twitterBudget}/mo.${apiKeys.twitter ? "" : " — No key set."}` },
            { id:"sentiment",      label:"AI sentiment analysis", desc:"Use LLM to refine sentiment scoring. Disable to use fast keyword-only mode." },
          ].map(f => (
            <div key={f.id} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{f.label}</div>
                <div style={{ fontSize:11, color:T.dim, marginTop:3 }}>{f.desc}</div>
              </div>
              <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                <span style={{ fontSize:11, color:features[f.id] ? "#4ade80" : T.faint }}>{features[f.id] ? "On" : "Off"}</span>
                <input type="checkbox" checked={!!features[f.id]} onChange={e => setFeature(f.id, e.target.checked)} />
              </label>
            </div>
          ))}

          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 18px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:10 }}>Default date range</div>
            <div style={{ display:"flex", gap:8 }}>
              {DATE_RANGES.map(r => (
                <button key={r.id} onClick={() => setDateRange(r.id)} style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${settings.dateRange===r.id ? T.accent+"80" : T.border}`, background:settings.dateRange===r.id ? T.accentDim : "transparent", color:settings.dateRange===r.id ? T.accent : T.dim }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "outlets" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center" }}>
            <Input value={outletSearch} onChange={setOutletSearch} placeholder="Search outlets…" style={{ width:240 }} />
            {["All","T1","T2","T3"].map(t => (
              <button key={t} onClick={() => setOutletTier(t)} style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:`1px solid ${outletTier===t ? T.accent+"80" : T.border}`, background:outletTier===t ? T.accentDim : "transparent", color:outletTier===t ? T.accent : T.dim }}>
                {t}
              </button>
            ))}
            <span style={{ fontSize:11, color:T.faint, marginLeft:"auto" }}>{filteredOutlets.length} outlets</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:500, overflowY:"auto" }}>
            {filteredOutlets.map(o => (
              <div key={o.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:T.card, borderRadius:8, border:`1px solid ${T.border}` }}>
                <span style={{ fontSize:11, fontWeight:700, color:tc(o.tier), width:20 }}>T{o.tier}</span>
                <span style={{ fontSize:12, color:T.text, flex:1 }}>{o.name}</span>
                <span style={{ fontSize:10, color:T.faint }}>{o.cat}</span>
                {o.domain && <span style={{ fontSize:10, color:T.faint, fontFamily:"monospace" }}>{o.domain}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "data" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:6 }}>Storage</div>
            {(() => {
              const used = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
              const pct = Math.round(used / (5 * 1024 * 1024) * 100);
              return (
                <>
                  <div style={{ fontSize:11, color:T.dim, marginBottom:8 }}>{(used / 1024).toFixed(0)} KB used of ~5 MB ({pct}%)</div>
                  <div style={{ height:6, background:T.ghost, borderRadius:3 }}>
                    <div style={{ height:"100%", width:`${pct}%`, background: pct > 80 ? "#ef4444" : pct > 60 ? "#f59e0b" : T.accent, borderRadius:3 }} />
                  </div>
                </>
              );
            })()}
          </div>

          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:6 }}>Export / Import</div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:14, lineHeight:1.6 }}>
              Export saves your company configuration — boolean queries, competitors, settings — as a JSON file.<br />
              Import restores a previous export. Run results are not included in exports to keep file size small.
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
              <Btn onClick={handleExport} variant="ghost">⬇ Export data</Btn>
              <label style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 14px", borderRadius:8, border:`1px solid ${T.border}`, fontSize:12, fontWeight:600, color:T.dim, cursor:"pointer", background:"transparent" }}>
                ⬆ Import data
                <input type="file" accept=".json" onChange={handleImport} style={{ display:"none" }} />
              </label>
            </div>
          </div>

          <div style={{ background:"rgba(239,68,68,0.04)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:12, padding:"16px 20px" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#f87171", marginBottom:6 }}>Danger zone</div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:12 }}>Reset all data including API keys, companies, and run history. Cannot be undone.</div>
            <Btn onClick={handleReset} variant="danger">Reset all data</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Company Modal ─────────────────────────────────────────────────────────

function AddCompanyModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [website, setWebsite] = useState("");
  const [cats, setCats] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());

  const handleAdd = () => {
    if (!name.trim()) return;
    const id = Date.now();
    const categories = cats.split(",").map(c => c.trim()).filter(Boolean);
    const boolQ = BOOLEAN_QUERIES[name] || `"${name}"`;
    onAdd({
      id, name: name.trim(), description: desc.trim(), website: website.trim(),
      categories, year: parseInt(year) || new Date().getFullYear(),
      enabled: true,
      boolean_query: boolQ,
      boolean_approved: Boolean(BOOLEAN_QUERIES[name]),
      competitors: [],
      runs: [],
      sovRun: null,
    });
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#0e0e1a", border:`1px solid ${T.border}`, borderRadius:16, padding:"24px 28px", width:500, maxWidth:"90vw" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:20 }}>Add company</div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Company name *</div>
            <Input value={name} onChange={setName} placeholder="e.g. Cohere" />
          </div>
          <div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Description</div>
            <Input value={desc} onChange={setDesc} placeholder="One-line description" />
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Website</div>
              <Input value={website} onChange={setWebsite} placeholder="company.com" />
            </div>
            <div style={{ width:100 }}>
              <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Year</div>
              <Input value={year} onChange={setYear} placeholder="2024" />
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Categories (comma-separated)</div>
            <Input value={cats} onChange={setCats} placeholder="LLMs, Software" />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:20, justifyContent:"flex-end" }}>
          <Btn onClick={onClose} variant="ghost">Cancel</Btn>
          <Btn onClick={handleAdd} variant="primary">Add company</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Sandbox ───────────────────────────────────────────────────────────────────

function makeSandboxDraft() {
  return { id:`sandbox-${Date.now()}`, name:"", description:"", website:"", categories:[], boolean_query:"", boolean_approved:false, competitors:[], twitter_handle:"", twitter_accounts:[], runs:[], sovRun:null };
}

function Sandbox({ sandboxCompanies, onSave, onDelete, onPromote, settings, toast }) {
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft]           = useState(makeSandboxDraft);
  const [running, setRunning]       = useState(false);
  const [progress, setProgress]     = useState("");
  const [suggestingBool, setSuggestingBool]   = useState(false);
  const [suggestingComps, setSuggestingComps] = useState(false);
  const [compInput, setCompInput]   = useState("");
  const [activeTab, setActiveTab]   = useState("overview"); // overview | ask

  const hasLLM = !!(settings.apiKeys?.vertex_enabled !== false || settings.apiKeys?.gemini || settings.apiKeys?.anthropic || settings.apiKeys?.cohere_north_key || settings.apiKeys?.cohere);

  const selectSaved = c => { setSelectedId(c.id); setDraft({ ...c }); setActiveTab("overview"); };
  const startNew    = () => { setSelectedId(null); setDraft(makeSandboxDraft()); setActiveTab("overview"); };

  const patch = updater => setDraft(d => typeof updater === "function" ? updater(d) : { ...d, ...updater });

  const handleSuggestBoolean = async () => {
    if (!draft.name) { toast("Enter a company name first", "error"); return; }
    setSuggestingBool(true);
    try {
      const sys = "You are an expert at writing precise boolean search queries for news monitoring APIs. Return ONLY the query string, no explanation, no markdown.";
      const prompt = `Write a NewsAPI boolean search query for a company called "${draft.name}".${draft.description ? `\nWhat they do: ${draft.description}` : ""}${draft.website ? `\nWebsite: ${draft.website}` : ""}\n\nRules:\n- Use AND, OR, NOT and quoted phrases\n- Specific enough to avoid noise, broad enough to catch real coverage\n- Exclude obvious false positives\n\nReturn ONLY the query string.`;
      const result = await callLLM(prompt, sys, settings.apiKeys);
      patch({ boolean_query: result.trim(), boolean_approved: true });
    } catch(e) { toast("AI suggestion failed: " + e.message, "error"); }
    setSuggestingBool(false);
  };

  const handleSuggestCompetitors = async () => {
    if (!draft.name) { toast("Enter a company name first", "error"); return; }
    setSuggestingComps(true);
    try {
      const sys = "You are a VC analyst. Return ONLY a valid JSON array of competitor company name strings. No explanation.";
      const prompt = `List 4–5 direct competitors for "${draft.name}".${draft.description ? `\nWhat they do: ${draft.description}` : ""}${draft.categories?.length ? `\nCategories: ${draft.categories.join(", ")}` : ""}\nDo NOT include Google, Amazon, Microsoft, OpenAI, or Anthropic.\nReturn ONLY a JSON array, e.g. ["Acme Corp", "Beta Inc"]`;
      const raw = await callLLM(prompt, sys, settings.apiKeys);
      const parsed = parseJSON(raw);
      if (Array.isArray(parsed)) {
        patch({ competitors: parsed.map(name => ({ id:`comp-sb-${Date.now()}-${name.replace(/\W/g,"")}`, name, rationale:"" })) });
      } else { toast("Could not parse AI response", "error"); }
    } catch(e) { toast("AI suggestion failed: " + e.message, "error"); }
    setSuggestingComps(false);
  };

  const addCompetitor = () => {
    const name = compInput.trim();
    if (!name) return;
    patch(d => ({ ...d, competitors: [...(d.competitors||[]), { id:`comp-sb-${Date.now()}`, name, rationale:"" }] }));
    setCompInput("");
  };

  const handleRun = async () => {
    if (!draft.name) { toast("Enter a company name first", "error"); return; }
    const { apiKeys, features } = settings;
    if (features.newsEnabled === false && !(features.twitterEnabled && apiKeys.twitter)) { toast("Enable at least one data source in Admin", "error"); return; }
    setRunning(true);
    try {
      const result = await runCompany(draft, settings, setProgress);
      const updated = { ...draft, runs: [result, ...(draft.runs||[])].slice(0, 3) };
      patch(updated);
      if (selectedId) onSave(updated); // auto-save if already saved
      toast(`Done — ${result.mediaCount||0} articles, ${result.socialCount||0} social posts`, "success");
    } catch(e) { toast("Run failed: " + e.message, "error"); }
    setRunning(false); setProgress("");
  };

  const handleSave = () => {
    const c = { ...draft, savedAt: new Date().toISOString() };
    onSave(c);
    setSelectedId(c.id);
    toast(`"${c.name}" saved to Sandbox`, "success");
  };

  const handleSandboxDownload = () => {
    const r = draft.runs?.[0];
    if (!r) return;
    const dateStr = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
    const sent    = r.sentimentScore || 0;
    const media   = r.mediaResults  || [];
    const social  = r.socialResults || [];
    const themes  = detectThemes(media);

    const t1 = media.filter(m => m.tier === 1).length;
    const t2 = media.filter(m => m.tier === 2).length;
    const t3 = media.filter(m => m.tier === 3).length;
    const byPlat = {};
    social.forEach(s => { byPlat[s.platform] = (byPlat[s.platform] || 0) + 1; });

    const sentSVG  = exportSentimentSVG(sent);
    const tierSVG  = (t1||t2||t3) ? exportBarsSVG([
      { label:"Tier 1 (flagship)", value:t1, color:"#818cf8" },
      { label:"Tier 2 (major)",    value:t2, color:"#60a5fa" },
      { label:"Tier 3 (trade)",    value:t3, color:"#94a3b8" },
    ]) : "";
    const themeSVG = themes.length ? exportBarsSVG(themes.slice(0,8).map(t=>({ label:t.label, value:t.articles.length, color:"#f59e0b" }))) : "";
    const platSVG  = Object.keys(byPlat).length ? exportBarsSVG(Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([p,n])=>({ label:p, value:n, color: PLAT[p]?.color||"#f59e0b" }))) : "";
    const sparkSVG = draft.runs?.length > 1 ? exportSparklineSVG(draft.runs) : "";

    const topArticles = media.slice(0, 8);
    const articlesHTML = topArticles.length ? topArticles.map(a => `
      <div style="padding:10px 0;border-bottom:1px solid #f3f4f6">
        <div style="font-size:12px;font-weight:700;color:#111;margin-bottom:3px">${a.title || "Untitled"}</div>
        <div style="font-size:11px;color:#6b7280">${a.source?.name || a.source || ""} ${a.publishedAt ? "· " + a.publishedAt.slice(0,10) : ""} ${a.url ? `· <a href="${a.url}" style="color:#818cf8">${a.url.replace(/^https?:\/\/(www\.)?/,"").split("/")[0]}</a>` : ""}</div>
      </div>`).join("") : "";

    const sentColor = sent > 0.2 ? "#16a34a" : sent < -0.2 ? "#dc2626" : "#d97706";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${draft.name} — Sandbox Research Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 28px; color: #111; background: #fff; }
  @media print { body { margin: 20px; } }
  .section-label { font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
  .chart-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  .chart-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  svg text { paint-order: stroke fill; }
</style>
</head><body>

<div style="border-bottom:2px solid #f59e0b;padding-bottom:16px;margin-bottom:24px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between">
    <div>
      <div style="font-size:10px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">⬡ Sandbox Research</div>
      <h1 style="font-size:24px;font-weight:900;margin:0;letter-spacing:-0.03em">${draft.name}</h1>
      <p style="color:#6b7280;font-size:13px;margin:4px 0 0">Prepared by Radical Intelligence Platform · ${dateStr}</p>
      ${draft.description ? `<p style="color:#374151;font-size:12px;margin:6px 0 0;font-style:italic">${draft.description}</p>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af">
      ${media.length} articles · ${social.length} posts<br>
      ${r.fromDate||""} → ${r.ranAt?.slice(0,10)||""}
    </div>
  </div>
  ${draft.competitors?.length ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
    <span style="font-size:10px;color:#6b7280;font-weight:700;align-self:center">Competitors tracked:</span>
    ${draft.competitors.map(c=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e;font-weight:600">${c.name}</span>`).join("")}
  </div>` : ""}
</div>

<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Coverage Data</h2>

  ${sentSVG ? `<div class="chart-card">
    <div class="section-label">Overall Sentiment</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="font-size:32px;font-weight:900;color:${sentColor};letter-spacing:-0.04em">${sent>=0?"+":""}${sent.toFixed(2)}</div>
      <div style="flex:1">${sentSVG}${sparkSVG ? `<div style="margin-top:6px"><div class="section-label">Sentiment trend</div>${sparkSVG}</div>` : ""}</div>
    </div>
  </div>` : ""}

  ${(tierSVG||platSVG) ? `<div class="${tierSVG && platSVG ? "chart-grid-2" : ""}">
    ${tierSVG ? `<div class="chart-card"><div class="section-label">Outlet Tiers</div>${tierSVG}</div>` : ""}
    ${platSVG ? `<div class="chart-card"><div class="section-label">Social Platforms</div>${platSVG}</div>` : ""}
  </div>` : ""}

  ${themeSVG ? `<div class="chart-card">
    <div class="section-label">Coverage Themes (${themes.length} detected)</div>
    ${themeSVG}
  </div>` : ""}
</div>

${articlesHTML ? `<div style="margin-bottom:28px">
  <h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.05em">Top Articles</h2>
  <div class="chart-card" style="padding:0 18px">${articlesHTML}</div>
</div>` : ""}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Generated by Radical Intelligence Platform · Radical Ventures · ${dateStr}
</div>

</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { toast("Pop-up blocked — allow pop-ups to use Download", "error"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  const run = draft.runs?.[0];
  const hasResults = !!(run?.mediaResults?.length || run?.socialResults?.length);
  const isSaved = !!selectedId;

  const ACCENT_SANDBOX = "#f59e0b"; // amber — distinct from portfolio indigo

  return (
    <div style={{ display:"flex", height:"calc(100vh - 52px)", overflow:"hidden" }}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div style={{ width:220, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", flexShrink:0, background:"rgba(0,0,0,0.15)" }}>
        <div style={{ padding:"14px 14px 10px", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ fontSize:12, fontWeight:800, color:ACCENT_SANDBOX, letterSpacing:"0.04em", textTransform:"uppercase" }}>⬡ Sandbox</div>
          <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>{sandboxCompanies.length} saved · deal research</div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:8 }}>
          <button onClick={startNew}
            style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:`1px dashed ${ACCENT_SANDBOX}40`, background:"transparent", color:ACCENT_SANDBOX, fontSize:11, fontWeight:700, cursor:"pointer", marginBottom:8, textAlign:"left" }}>
            + New research
          </button>
          {sandboxCompanies.length === 0 && (
            <div style={{ fontSize:11, color:T.faint, padding:"8px 4px", lineHeight:1.5 }}>No saved research yet. Start by entering a company above.</div>
          )}
          {sandboxCompanies.map(c => (
            <div key={c.id} onClick={() => selectSaved(c)}
              style={{ padding:"8px 10px", borderRadius:8, marginBottom:3, cursor:"pointer",
                background: selectedId===c.id ? `${ACCENT_SANDBOX}18` : "transparent",
                border:`1px solid ${selectedId===c.id ? ACCENT_SANDBOX+"40" : "transparent"}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{c.name}</span>
                <button onClick={e => { e.stopPropagation(); onDelete(c.id); if(selectedId===c.id){ startNew(); } }}
                  style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:14, padding:0, lineHeight:1 }}>×</button>
              </div>
              {c.runs?.[0] && <div style={{ fontSize:10, color:T.dim, marginTop:2 }}>{c.runs[0].mediaCount||0} art · {c.runs[0].socialCount||0} soc · <span style={{ color: (c.runs[0].sentimentScore||0)>0.1?"#4ade80":(c.runs[0].sentimentScore||0)<-0.1?"#f87171":"#f59e0b" }}>{(c.runs[0].sentimentScore||0)>=0?"+":""}{(c.runs[0].sentimentScore||0).toFixed(2)}</span></div>}
              <div style={{ fontSize:10, color:T.faint }}>{c.savedAt ? ago(c.savedAt) : "unsaved"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main panel ──────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:"auto" }}>
        <div style={{ maxWidth:920, margin:"0 auto", padding:"24px 32px" }}>

          {/* Header */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
            <div>
              <div style={{ fontSize:20, fontWeight:800, color:T.text }}>
                {draft.name || <span style={{ color:T.faint }}>New Research</span>}
              </div>
              <div style={{ fontSize:12, color:T.dim, marginTop:3 }}>
                Research a prospect before adding to portfolio — AI-assisted queries, competitor mapping, news & social scan
              </div>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end", alignItems:"center" }}>
              {/* Source toggles */}
              {[
                { key:"newsEnabled",    label:"News",    color:"#60a5fa", default:true },
                { key:"twitterEnabled", label:"Twitter", color:"#1d9bf0" },
              ].map(s => {
                const on = settings.features?.[s.key] ?? s.default ?? false;
                const hasKey = s.key === "twitterEnabled" ? !!settings.apiKeys?.twitter : true;
                return (
                  <button key={s.key}
                    onClick={() => s.key === "twitterEnabled" && !hasKey ? null : undefined}
                    title={s.key === "twitterEnabled" && !hasKey ? "Add Twitter API key in Admin → API Keys" : `${on ? "Enabled" : "Disabled"} — toggle in Admin`}
                    style={{ padding:"3px 9px", borderRadius:20, fontSize:10, fontWeight:700, cursor:"default", border:`1px solid ${on && hasKey ? s.color+"60" : T.border}`, background:on && hasKey ? `${s.color}18` : "transparent", color:on && hasKey ? s.color : T.faint }}>
                    {on && hasKey ? "●" : "○"} {s.label}
                  </button>
                );
              })}
              {isSaved && onPromote && (
                <Btn onClick={() => onPromote(draft)} variant="ghost" style={{ fontSize:11 }}>→ Add to Portfolio</Btn>
              )}
              {draft.name && hasResults && !isSaved && (
                <Btn onClick={handleSave} variant="ghost">Save to Sandbox</Btn>
              )}
              {draft.name && hasResults && isSaved && (
                <Btn onClick={handleSave} variant="ghost" style={{ fontSize:11 }}>Update saved</Btn>
              )}
              {hasResults && (
                <Btn onClick={handleSandboxDownload} variant="ghost" style={{ fontSize:11 }}>⬇ Download</Btn>
              )}
              <Btn onClick={handleRun} disabled={running || !draft.name} variant="primary"
                style={{ background:`${ACCENT_SANDBOX}`, borderColor:ACCENT_SANDBOX, color:"#000" }}>
                {running ? <><Spinner /> {progress||"Running…"}</> : "▶ Run research"}
              </Btn>
            </div>
          </div>

          {/* Company fields */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:12 }}>Company details</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 100px", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Company name *</div>
                <Input value={draft.name} onChange={v => patch({ name:v })} placeholder="e.g. Acme AI" />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Website</div>
                <Input value={draft.website||""} onChange={v => patch({ website:v })} placeholder="acme.ai" />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>
                  Twitter handle
                  {!(settings.features?.twitterEnabled && settings.apiKeys?.twitter) && <span style={{ color:T.faint, fontWeight:400 }}> (Twitter not enabled)</span>}
                </div>
                <Input value={draft.twitter_handle||""} onChange={v => patch({ twitter_handle:v.replace(/^@/,"") })} placeholder="@handle" />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Year founded</div>
                <Input value={draft.year||""} onChange={v => patch({ year:v })} placeholder="2024" />
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Description <span style={{ color:T.faint }}>(helps AI generate better suggestions)</span></div>
              <Input value={draft.description||""} onChange={v => patch({ description:v })} placeholder="What does this company do? Who are their customers?" />
            </div>
          </div>

          {/* Boolean query */}
          {(() => {
            const savedQuery = sandboxCompanies.find(c => c.id === selectedId)?.boolean_query || "";
            const currentQuery = draft.boolean_query || "";
            const hasQuery = !!currentQuery.trim();
            const queryChanged = isSaved && currentQuery !== savedQuery;

            return (
              <div style={{ background:T.card, border:`1px solid ${hasQuery ? T.accent+"40" : T.border}`, borderRadius:12, padding:"16px 20px", marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Boolean search query</div>
                  <Btn onClick={handleSuggestBoolean} disabled={suggestingBool||!draft.name||!hasLLM} variant="ghost" style={{ fontSize:11 }}>
                    {suggestingBool ? <><Spinner/> Generating…</> : "✦ AI suggest"}
                  </Btn>
                </div>
                <textarea value={currentQuery} onChange={e => patch({ boolean_query:e.target.value, boolean_approved:true })}
                  placeholder={`"${draft.name||"Company"}" AND ("AI" OR "funding" OR "launch") NOT "false positive"`}
                  rows={3}
                  style={{ width:"100%", background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"8px 11px", fontSize:12, color:T.text, outline:"none", resize:"vertical", fontFamily:"monospace", boxSizing:"border-box" }}
                />
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8, gap:8, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {hasQuery ? (
                      <span style={{ fontSize:11, color:"#4ade80", fontWeight:600 }}>✓ Active — will be used in next run</span>
                    ) : (
                      <span style={{ fontSize:11, color:T.faint }}>No query set — enter one above or use AI suggest</span>
                    )}
                    {hasQuery && !isSaved && (
                      <span style={{ fontSize:10, color:"#f59e0b" }}>· Not saved yet — click "Save to Sandbox" to persist</span>
                    )}
                    {queryChanged && (
                      <span style={{ fontSize:10, color:"#f59e0b" }}>· Unsaved changes</span>
                    )}
                  </div>
                  {queryChanged && (
                    <Btn onClick={() => { const c = { ...draft, savedAt: new Date().toISOString() }; onSave(c); toast("Query saved", "success"); }} variant="ghost" style={{ fontSize:10, padding:"3px 10px" }}>
                      Save now
                    </Btn>
                  )}
                </div>
                {!hasLLM && <div style={{ fontSize:10, color:T.faint, marginTop:4 }}>Add an LLM key in Admin → API Keys to enable AI suggestions.</div>}
              </div>
            );
          })()}

          {/* Competitors */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, color:T.dim, textTransform:"uppercase", letterSpacing:"0.07em" }}>Competitors <span style={{ color:T.faint, fontWeight:400, fontSize:10, textTransform:"none" }}>for share of voice analysis</span></div>
              <Btn onClick={handleSuggestCompetitors} disabled={suggestingComps||!draft.name||!hasLLM} variant="ghost" style={{ fontSize:11 }}>
                {suggestingComps ? <><Spinner/> Suggesting…</> : "✦ AI suggest"}
              </Btn>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8, minHeight:28 }}>
              {(draft.competitors||[]).map(c => (
                <span key={c.id} style={{ padding:"4px 10px", borderRadius:20, background:T.ghost, border:`1px solid ${T.border}`, fontSize:12, color:T.text, display:"flex", alignItems:"center", gap:5 }}>
                  {c.name}
                  <button onClick={() => patch(d => ({ ...d, competitors: d.competitors.filter(x => x.id!==c.id) }))}
                    style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", padding:0, fontSize:13, lineHeight:1 }}>×</button>
                </span>
              ))}
              {(draft.competitors||[]).length === 0 && <span style={{ fontSize:11, color:T.faint }}>No competitors added yet</span>}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <Input value={compInput} onChange={setCompInput} placeholder="Type a competitor name and press Enter…"
                onKeyDown={e => { if(e.key==="Enter"){ e.preventDefault(); addCompetitor(); } }} style={{ flex:1 }} />
              <Btn onClick={addCompetitor} variant="ghost">Add</Btn>
            </div>
          </div>

          {/* Results */}
          {hasResults && (
            <div>
              {/* Result tabs */}
              <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${T.border}`, marginBottom:16 }}>
                {[{id:"overview",label:"Overview"},{id:"ask",label:"✦ Ask AI"}].map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                    style={{ padding:"8px 16px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight:600,
                      color:activeTab===t.id ? ACCENT_SANDBOX : T.dim,
                      borderBottom:activeTab===t.id ? `2px solid ${ACCENT_SANDBOX}` : "2px solid transparent", marginBottom:-1 }}>
                    {t.label}
                  </button>
                ))}
                <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, paddingBottom:4, fontSize:11, color:T.dim }}>
                  {run.mediaCount||0} articles · {run.socialCount||0} social ·
                  <span style={{ color:(run.sentimentScore||0)>0.1?"#4ade80":(run.sentimentScore||0)<-0.1?"#f87171":"#f59e0b", fontWeight:700 }}>
                    {(run.sentimentScore||0)>=0?"+":""}{(run.sentimentScore||0).toFixed(2)} sentiment
                  </span>
                </div>
              </div>
              {activeTab==="overview" && <OverviewTab company={draft} run={run} />}
              {activeTab==="ask"      && <AskAITab company={draft} settings={settings} />}
            </div>
          )}

          {/* Empty run state */}
          {!hasResults && !running && (
            <div style={{ textAlign:"center", padding:"48px 0", color:T.dim }}>
              <div style={{ fontSize:32, marginBottom:12 }}>⬡</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>Ready to research</div>
              <div style={{ fontSize:12, color:T.dim, marginBottom:20 }}>Fill in the company details above, optionally generate AI suggestions, then click Run research</div>
              <Btn onClick={handleRun} disabled={!draft.name} variant="primary" style={{ background:ACCENT_SANDBOX, borderColor:ACCENT_SANDBOX, color:"#000" }}>
                ▶ Run research
              </Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState(() => loadState());
  const [view, setView] = useState("portfolio");
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const { fire: toast, Toasts } = useToast();

  useEffect(() => { saveState(state); }, [state]);

  const { companies, outlets, settings, sandboxCompanies = [] } = state;

  const updateSettings  = useCallback(s  => setState(prev => ({ ...prev, settings: s })), []);
  const updateOutlets   = useCallback(o  => setState(prev => ({ ...prev, outlets: o })), []);
  const updateCompanies = useCallback(cs => setState(prev => ({ ...prev, companies: cs })), []);

  const updateCompany = useCallback(updated => {
    setState(prev => ({ ...prev, companies: prev.companies.map(c => c.id === updated.id ? updated : c) }));
    if (selectedCompany?.id === updated.id) setSelectedCompany(updated);
  }, [selectedCompany]);

  const addCompany = useCallback(company => {
    setState(prev => ({ ...prev, companies: [...prev.companies, company] }));
  }, []);

  // Sandbox handlers
  const saveSandboxCompany = useCallback(company => {
    setState(prev => {
      const existing = prev.sandboxCompanies || [];
      const idx = existing.findIndex(c => c.id === company.id);
      const updated = idx >= 0 ? existing.map(c => c.id === company.id ? company : c) : [...existing, company];
      return { ...prev, sandboxCompanies: updated };
    });
  }, []);

  const deleteSandboxCompany = useCallback(id => {
    setState(prev => ({ ...prev, sandboxCompanies: (prev.sandboxCompanies||[]).filter(c => c.id !== id) }));
  }, []);

  const promoteSandboxToPortfolio = useCallback(sandboxCompany => {
    // Convert sandbox entry to portfolio company format with a new numeric id
    const newId = Date.now();
    const portfolioCompany = {
      ...sandboxCompany,
      id: newId,
      enabled: true,
      boolean_approved: !!sandboxCompany.boolean_query,
    };
    delete portfolioCompany.savedAt;
    setState(prev => ({
      ...prev,
      companies: [...prev.companies, portfolioCompany],
      sandboxCompanies: (prev.sandboxCompanies||[]).filter(c => c.id !== sandboxCompany.id),
    }));
    setView("portfolio");
    toast(`"${sandboxCompany.name}" added to Portfolio`, "success");
  }, [toast]);

  const handleRun = useCallback(async (company) => {
    const { apiKeys, features } = settings;
    const hasNews    = features.newsEnabled !== false && !!apiKeys.newsapi;
    const hasTwitter = !!(features.twitterEnabled && apiKeys.twitter);
    const hasLegacy  = !!(apiKeys.yutori || apiKeys.data365);
    if (!hasNews && !hasTwitter && !hasLegacy) {
      toast("Configure API keys in Admin → API Keys to run searches", "error"); return;
    }
    try {
      const result = await runCompany(company, { ...settings, outlets }, () => {});
      const prevRun = company.runs?.[0] || {};
      const newsWasOff    = features.newsEnabled === false;
      const twitterWasOff = !(features.twitterEnabled && apiKeys.twitter);
      // Preserve existing results for any source that was toggled off this run
      const mergedResult = {
        ...result,
        ...(newsWasOff && prevRun.mediaResults?.length ? {
          mediaResults: prevRun.mediaResults,
          mediaCount:   prevRun.mediaCount ?? prevRun.mediaResults.length,
        } : {}),
        ...(twitterWasOff && prevRun.socialResults?.length ? {
          socialResults: prevRun.socialResults,
          socialCount:   prevRun.socialCount ?? prevRun.socialResults.length,
        } : {}),
      };
      const updatedRuns = [mergedResult, ...(company.runs || [])].slice(0, 3);
      updateCompany({ ...company, runs: updatedRuns });
      // Track Twitter spend + run log
      if (result.twitterCost > 0) {
        const monthKey = new Date().toISOString().slice(0, 7);
        const prev = settings.twitterSpend || {};
        const prevLog = settings.twitterRunLog || [];
        const logEntry = { at: new Date().toISOString(), company: company.name, tweets: result.socialCount || 0, cost: result.twitterCost };
        updateSettings({ ...settings,
          twitterSpend: { ...prev, [monthKey]: (prev[monthKey] || 0) + result.twitterCost },
          twitterRunLog: [logEntry, ...prevLog].slice(0, 200),
        });
      }
    } catch (e) { toast("Run failed: " + e.message, "error"); }
  }, [settings, outlets, updateCompany, toast]);

  const handleRunAll = useCallback(async () => {
    const enabled = companies.filter(c => c.enabled !== false);
    for (const c of enabled) {
      try { await handleRun(c); } catch {}
    }
    toast(`Ran ${enabled.length} companies`, "success");
  }, [companies, handleRun, toast]);

  const signalCount = useMemo(() => {
    return companies.filter(c => c.enabled !== false && (c.runs?.[0]?.sentimentScore || 0) < -0.2).length
      + companies.filter(c => !c.boolean_approved).length;
  }, [companies]);

  const navItems = [
    { id:"portfolio", label:"Portfolio" },
    { id:"signals",   label:`Signals${signalCount > 0 ? ` (${signalCount})` : ""}` },
    { id:"sandbox",   label:"⬡ Sandbox" },
    { id:"admin",     label:"Admin" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"system-ui, -apple-system, sans-serif", display:"flex", flexDirection:"column" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.25); }
        select option { background: #1a1a2e; }
      `}</style>

      {/* Nav */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:"0 32px", display:"flex", alignItems:"center", gap:24, height:52, flexShrink:0 }}>
        <div style={{ fontSize:14, fontWeight:800, color:T.accent, letterSpacing:"-0.01em", marginRight:8 }}>◈ Radical Intelligence</div>
        {navItems.map(item => (
          <button key={item.id} onClick={() => { setView(item.id); setSelectedCompany(null); }}
            style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:view===item.id && !selectedCompany ? T.accent : T.dim, borderBottom:view===item.id && !selectedCompany ? `2px solid ${T.accent}` : "2px solid transparent", padding:"0 0 2px 0", height:"100%", transition:"color 0.15s" }}>
            {item.label}
          </button>
        ))}
        {selectedCompany && (
          <div style={{ display:"flex", alignItems:"center", gap:8, color:T.dim, fontSize:13 }}>
            <span>›</span>
            <span style={{ color:T.text, fontWeight:600 }}>{selectedCompany.name}</span>
          </div>
        )}
      </div>

      {/* Main */}
      <div style={{ flex:1, overflowY:"auto" }}>
        {selectedCompany ? (
          <CompanyDetail
            company={selectedCompany}
            settings={{ ...settings, outlets }}
            onBack={() => setSelectedCompany(null)}
            onRun={handleRun}
            onUpdate={updateCompany}
            onUpdateSettings={updateSettings}
            toast={toast}
          />
        ) : view === "portfolio" ? (
          <Portfolio
            companies={companies}
            settings={settings}
            onSelect={c => { setSelectedCompany(c); setView("portfolio"); }}
            onRun={handleRun}
            onRunAll={handleRunAll}
            onUpdateCompany={updateCompany}
            onAdd={() => setShowAddModal(true)}
            onUpdateSettings={updateSettings}
          />
        ) : view === "signals" ? (
          <Signals companies={companies} />
        ) : view === "sandbox" ? (
          <Sandbox
            sandboxCompanies={sandboxCompanies}
            onSave={saveSandboxCompany}
            onDelete={deleteSandboxCompany}
            onPromote={promoteSandboxToPortfolio}
            settings={settings}
            toast={toast}
          />
        ) : view === "admin" ? (
          <Admin
            settings={settings}
            outlets={outlets}
            companies={companies}
            onUpdateSettings={updateSettings}
            onUpdateOutlets={updateOutlets}
            onUpdateCompanies={updateCompanies}
            toast={toast}
          />
        ) : null}
      </div>

      {showAddModal && <AddCompanyModal onAdd={addCompany} onClose={() => setShowAddModal(false)} />}
      <Toasts />
    </div>
  );
}
