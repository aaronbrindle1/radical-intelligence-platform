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
      // Patch isFirm flag on existing entries (won't be present in old saved state)
      saved.companies = saved.companies.map(c => {
        const canon = canonicalMap[c.id];
        if (canon?.isFirm && !c.isFirm) return { ...c, isFirm: true };
        return c;
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
  return { ...state, settings: { ...s, apiKeys, features: f, twitterSpend: s.twitterSpend || {} } };
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

const Input = ({ value, onChange, placeholder, style={} }) => (
  <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
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

function SocialCard({ item }) {
  const p = PLAT[item.platform] || PLAT.web;
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:12, fontWeight:800, color:p.color, width:20, textAlign:"center" }}>{p.icon}</span>
        <span style={{ fontSize:11, fontWeight:600, color:T.dim }}>{item.author}</span>
        {item.subreddit && <span style={{ fontSize:10, color:T.faint }}>{item.subreddit}</span>}
        <span style={{ fontSize:10, color:T.faint, marginLeft:"auto" }}>{item.date}</span>
        <Pip score={item.sentiment || 0} />
      </div>
      <p style={{ fontSize:12, color:T.text, margin:0, lineHeight:1.5 }}>{(item.text || "").slice(0, 240)}{(item.text || "").length > 240 ? "…" : ""}</p>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        {item.likes > 0 && <span style={{ fontSize:10, color:T.faint }}>▲ {fmt(item.likes)}</span>}
        {item.comments > 0 && <span style={{ fontSize:10, color:T.faint }}>💬 {fmt(item.comments)}</span>}
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:T.accent, marginLeft:"auto", textDecoration:"none" }}>Open ↗</a>}
      </div>
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
          <div style={{ position:"relative", height:8, borderRadius:4, background:"linear-gradient(to right,#ef4444 0%,#f59e0b 50%,#22c55e 100%)" }}>
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"50%", transform:"translate(-50%,-50%)", width:14, height:14, borderRadius:"50%", background:"white", border:`2.5px solid ${sentColor}`, boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:T.faint, marginTop:4 }}>
            <span>–1</span><span>0</span><span>+1</span>
          </div>
          <div style={{ marginTop:10, fontSize:10, color:T.dim }}>{withData.length} companies with data</div>
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))", gap:10 }}>
            {social.map(item => <SocialCard key={item.id} item={item} />)}
          </div>
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

// ── Company Detail — SOV tab ──────────────────────────────────────────────────

function SOVTab({ company, settings, onUpdate, toast }) {
  const [editMode, setEditMode] = useState(false);
  const [newComp, setNewComp] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const sov = company.sovRun;
  const competitors = company.competitors || [];

  const handleAdd = () => {
    if (!newComp.trim()) return;
    onUpdate({ ...company, competitors: [...competitors, { id: `c-${Date.now()}`, name: newComp.trim(), rationale: "" }] });
    setNewComp("");
  };

  const handleRemove = id => {
    onUpdate({ ...company, competitors: competitors.filter(c => c.id !== id) });
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

  const maxMedia = sov ? Math.max(...sov.results.map(r => r.mediaCount || 0), 1) : 1;
  const maxSocial = sov ? Math.max(...sov.results.map(r => r.socialCount || 0), 1) : 1;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      {/* Competitor management */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.text }}>Competitors ({competitors.length})</div>
          <div style={{ display:"flex", gap:6 }}>
            <Btn onClick={handleSuggest} disabled={suggesting} variant="ghost" style={{ fontSize:11 }}>{suggesting ? <><Spinner /> Suggesting…</> : "✨ AI suggest"}</Btn>
            <Btn onClick={() => setEditMode(!editMode)} variant="ghost" style={{ fontSize:11 }}>{editMode ? "Done" : "Edit"}</Btn>
          </div>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {competitors.map(c => (
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:6, background:T.ghost, padding:"5px 10px", borderRadius:20, fontSize:12, color:T.text }}>
              {c.name}
              {editMode && <button onClick={() => handleRemove(c.id)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", padding:0, fontSize:14, lineHeight:1 }}>×</button>}
            </div>
          ))}
        </div>
        {editMode && (
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <Input value={newComp} onChange={setNewComp} placeholder="Add competitor name…" />
            <Btn onClick={handleAdd} variant="primary">Add</Btn>
          </div>
        )}
      </div>

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

      {/* SOV results */}
      {sov?.results?.length > 0 && (
        <>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:12 }}>News coverage</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[...sov.results].sort((a, b) => (b.mediaCount || 0) - (a.mediaCount || 0)).map(r => (
                <div key={r.name} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:150, fontSize:12, fontWeight: r.isBase ? 700 : 500, color: r.isBase ? T.accent : T.text, flexShrink:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}</div>
                  <div style={{ flex:1, height:8, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${(r.mediaCount || 0) / maxMedia * 100}%`, background: r.isBase ? T.accent : T.dim, borderRadius:4 }} />
                  </div>
                  <div style={{ width:60, textAlign:"right", fontSize:12, color:T.dim }}>{r.mediaCount || 0}</div>
                  <Pip score={r.sentiment || 0} size={10} />
                </div>
              ))}
            </div>
          </div>

          {sov.results.some(r => r.socialCount > 0) && (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:12 }}>Social mentions</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[...sov.results].sort((a, b) => (b.socialCount || 0) - (a.socialCount || 0)).map(r => (
                  <div key={r.name} style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:150, fontSize:12, fontWeight: r.isBase ? 700 : 500, color: r.isBase ? T.accent : T.text, flexShrink:0 }}>{r.name}</div>
                    <div style={{ flex:1, height:8, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(r.socialCount || 0) / maxSocial * 100}%`, background: r.isBase ? T.accent : T.dim, borderRadius:4 }} />
                    </div>
                    <div style={{ width:60, textAlign:"right", fontSize:12, color:T.dim }}>{r.socialCount || 0}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sentiment spectrum */}
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:T.text, marginBottom:12 }}>Sentiment landscape</div>
            <div style={{ position:"relative", height:24, borderRadius:12, background:"linear-gradient(to right, #ef4444, #f59e0b, #22c55e)", overflow:"visible" }}>
              {sov.results.map(r => {
                const pct = Math.min(100, Math.max(0, ((r.sentiment || 0) + 1) / 2 * 100));
                return (
                  <div key={r.name} title={`${r.name}: ${(r.sentiment || 0).toFixed(2)}`}
                    style={{ position:"absolute", left:`${pct}%`, top:"50%", transform:"translate(-50%,-50%)", width:14, height:14, borderRadius:"50%", background: r.isBase ? T.accent : T.text, border:`2px solid ${T.bg}`, cursor:"default" }}
                  />
                );
              })}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.faint, marginTop:4 }}>
              <span>Very Negative</span><span>Neutral</span><span>Very Positive</span>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:10, flexWrap:"wrap" }}>
              {sov.results.map(r => (
                <div key={r.name} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background: r.isBase ? T.accent : T.text }} />
                  <span style={{ fontSize:11, color: r.isBase ? T.accent : T.dim }}>{r.name}</span>
                </div>
              ))}
            </div>
          </div>
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

// ── Company Detail — Briefing tab ─────────────────────────────────────────────

// ── Briefing data visualisation ───────────────────────────────────────────────

function BriefingCharts({ company }) {
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
  const sovRows = sov?.results ? [...sov.results].sort((a, b) => (b.mediaCount||0) - (a.mediaCount||0)) : [];
  const maxSov = Math.max(...sovRows.map(r => r.mediaCount || 0), 1);

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
            <div style={{ position:"absolute", left:`${sentPct}%`, top:"50%", transform:"translate(-50%,-50%)", width:16, height:16, borderRadius:"50%", background:"white", border:`2.5px solid ${sentColor}`, boxShadow:"0 1px 6px rgba(0,0,0,0.4)" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:T.faint, marginTop:5 }}>
            <span>Very Negative</span><span>Neutral</span><span>Very Positive</span>
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

      {/* Row 3: Social + SOV side by side */}
      {(platforms.length > 0 || sovRows.length > 0) && (
        <div style={{ display:"grid", gridTemplateColumns:platforms.length > 0 && sovRows.length > 0 ? "1fr 1fr" : "1fr", gap:12 }}>
          {platforms.length > 0 && (
            <Card title="Social Platforms">
              {platforms.map(([plat, count]) => {
                const meta = PLAT[plat] || { color:T.dim, icon:"◈" };
                return <MiniBar key={plat} label={`${meta.icon} ${plat}`} count={count} max={maxPlat} color={meta.color} labelWidth={90} />;
              })}
            </Card>
          )}
          {sovRows.length > 0 && (
            <Card title={`Share of Voice vs Peers (${sov.ranAt?.slice(0,10)||"last run"})`}>
              {sovRows.map(r => (
                <div key={r.name} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <div style={{ width:110, fontSize:11, fontWeight:r.isBase?700:400, color:r.isBase?T.accent:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flexShrink:0 }}>{r.name}</div>
                  <div style={{ flex:1, height:7, background:T.ghost, borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${Math.max(2,(r.mediaCount||0)/maxSov*100)}%`, background:r.isBase?T.accent:T.dim, borderRadius:4 }} />
                  </div>
                  <div style={{ width:26, textAlign:"right", fontSize:11, color:T.dim, flexShrink:0 }}>{r.mediaCount||0}</div>
                  <Pip score={r.sentiment||0} size={9} />
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
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

  const run = async () => {
    setLoading(true);
    setBriefing("");
    try {
      const result = await generateBriefing(company, persona, settings.apiKeys);
      setBriefing(result);
    } catch (e) { toast(e.message, "error"); }
    setLoading(false);
  };

  const handleDownload = () => {
    if (!briefing) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${company.name} — ${personas.find(p=>p.id===persona)?.label || "Briefing"}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7}h1{font-size:22px;font-weight:800;margin-bottom:4px}pre{white-space:pre-wrap;font-family:inherit;font-size:14px}@media print{body{margin:20px}}</style>
</head><body>
<h1>${company.name}</h1>
<p style="color:#6b7280;font-size:13px;margin-top:0">${personas.find(p=>p.id===persona)?.label} · ${new Date().toLocaleDateString("en-CA")}</p>
<pre>${briefing.replace(/</g,"&lt;")}</pre>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast("Pop-up blocked — allow pop-ups to download", "error"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const handleEmail = () => {
    if (!briefing) return;
    const subject = encodeURIComponent(`${company.name} — ${personas.find(p=>p.id===persona)?.label}`);
    const body = encodeURIComponent(briefing.slice(0, 1800) + (briefing.length > 1800 ? "\n\n[Full report available via download]" : ""));
    const to = encodeURIComponent(contactEmail || "");
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      {/* Data charts — always visible when run data exists */}
      <BriefingCharts company={company} />

      {/* Contact email (shown for report persona) */}
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
          <button key={p.id} onClick={() => setPersona(p.id)} style={{ padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`1px solid ${persona===p.id ? T.accent+"80" : T.border}`, background:persona===p.id ? T.accentDim : "transparent", color:persona===p.id ? T.accent : T.dim, textAlign:"left" }}>
            <div>{p.label}</div>
            <div style={{ fontSize:10, fontWeight:400, opacity:0.7, marginTop:2 }}>{p.desc}</div>
          </button>
        ))}
      </div>

      <Btn onClick={run} disabled={loading} variant="primary" style={{ width:"fit-content", padding:"8px 20px", fontSize:13 }}>
        {loading ? <><Spinner /> Generating…</> : "✦ Generate briefing"}
      </Btn>

      {briefing && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 24px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{personas.find(p=>p.id===persona)?.label}</div>
            <div style={{ display:"flex", gap:8 }}>
              <Btn variant="ghost" onClick={handleDownload} style={{ fontSize:11 }}>⬇ Download PDF</Btn>
              <Btn variant="ghost" onClick={handleEmail} style={{ fontSize:11 }}>✉ Email</Btn>
            </div>
          </div>
          <pre style={{ whiteSpace:"pre-wrap", fontSize:13, color:T.text, lineHeight:1.7, fontFamily:"inherit", margin:0 }}>{briefing}</pre>
        </div>
      )}
      {!briefing && !loading && (
        <div style={{ textAlign:"center", padding:"40px 0", color:T.faint, fontSize:12 }}>
          {company.runs?.[0] ? "Select a persona and generate a briefing" : "Run a search first to get coverage data"}
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

  const tabs = [
    { id:"overview", label:"Overview" },
    { id:"sov",      label:"Share of Voice" },
    { id:"briefing", label:"AI Briefing" },
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
  const twitterSpentThisMonth = (settings.twitterSpend || {})[monthKey] || 0;
  const twitterBudget = features.twitterBudgetMonthly || 10;
  const twitterBudgetPct = Math.min(100, (twitterSpentThisMonth / twitterBudget) * 100);

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

  const handleExport = () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), companies, outlets, settings }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type:"application/json" }));
    a.download = `radical-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleImport = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.companies) onUpdateCompanies(d.companies);
        if (d.outlets) onUpdateOutlets(d.outlets);
        if (d.settings) onUpdateSettings(d.settings);
        toast("Import successful", "success");
      } catch { toast("Import failed — invalid file", "error"); }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (confirm("Reset ALL data including companies, runs, and API keys? This cannot be undone.")) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
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

              {/* Budget & spend */}
              <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:12, display:"flex", gap:20, flexWrap:"wrap", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Monthly budget cap</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:13, color:T.faint }}>$</span>
                    <input type="number" min="0" step="5" value={features.twitterBudgetMonthly ?? 10}
                      onChange={e => setFeature("twitterBudgetMonthly", parseFloat(e.target.value) || 0)}
                      style={{ width:70, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 8px", fontSize:12, color:T.text, outline:"none" }}
                    />
                    <span style={{ fontSize:11, color:T.faint }}>/ month</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>Pages per run (20 tweets each)</div>
                  <input type="number" min="1" max="10" step="1" value={features.twitterMaxPages ?? 3}
                    onChange={e => setFeature("twitterMaxPages", parseInt(e.target.value) || 3)}
                    style={{ width:60, background:"rgba(0,0,0,0.3)", border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 8px", fontSize:12, color:T.text, outline:"none" }}
                  />
                  <div style={{ fontSize:10, color:T.faint, marginTop:3 }}>~${((features.twitterMaxPages ?? 3) * 20 * 0.00015).toFixed(4)} / run</div>
                </div>
                <div style={{ flex:"1 1 200px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:11, color:T.dim }}>Spent this month ({monthKey})</span>
                    <span style={{ fontSize:11, fontWeight:700, color:twitterBudgetPct > 80 ? "#f87171" : twitterBudgetPct > 50 ? "#fbbf24" : T.text }}>
                      ${twitterSpentThisMonth.toFixed(4)} / ${twitterBudget}
                    </span>
                  </div>
                  <div style={{ height:6, borderRadius:3, background:T.ghost, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${twitterBudgetPct}%`, background:twitterBudgetPct > 80 ? "#f87171" : twitterBudgetPct > 50 ? "#fbbf24" : T.accent, borderRadius:3, transition:"width 0.4s" }} />
                  </div>
                  {twitterBudgetPct >= 100 && <div style={{ fontSize:10, color:"#f87171", marginTop:4 }}>Budget reached — Twitter fetches paused until next month</div>}
                </div>
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
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:10 }}>Export / Import</div>
            <div style={{ display:"flex", gap:10 }}>
              <Btn onClick={handleExport} variant="primary">Export data</Btn>
              <label style={{ cursor:"pointer" }}>
                <Btn variant="ghost" onClick={() => {}}>Import data</Btn>
                <input type="file" accept=".json" onChange={handleImport} style={{ display:"none" }} />
              </label>
            </div>
          </div>

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

// ── App Root ──────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState(() => loadState());
  const [view, setView] = useState("portfolio");
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const { fire: toast, Toasts } = useToast();

  useEffect(() => { saveState(state); }, [state]);

  const { companies, outlets, settings } = state;

  const updateSettings = useCallback(s => setState(prev => ({ ...prev, settings: s })), []);
  const updateOutlets  = useCallback(o => setState(prev => ({ ...prev, outlets: o })), []);
  const updateCompanies = useCallback(cs => setState(prev => ({ ...prev, companies: cs })), []);

  const updateCompany = useCallback(updated => {
    setState(prev => ({ ...prev, companies: prev.companies.map(c => c.id === updated.id ? updated : c) }));
    if (selectedCompany?.id === updated.id) setSelectedCompany(updated);
  }, [selectedCompany]);

  const addCompany = useCallback(company => {
    setState(prev => ({ ...prev, companies: [...prev.companies, company] }));
  }, []);

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
      const updatedRuns = [result, ...(company.runs || [])].slice(0, 3);
      updateCompany({ ...company, runs: updatedRuns });
      // Track Twitter spend
      if (result.twitterCost > 0) {
        const monthKey = new Date().toISOString().slice(0, 7);
        const prev = settings.twitterSpend || {};
        updateSettings({ ...settings, twitterSpend: { ...prev, [monthKey]: (prev[monthKey] || 0) + result.twitterCost } });
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
