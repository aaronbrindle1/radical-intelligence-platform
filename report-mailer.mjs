// ─── Radical Intelligence — Monthly Report Mailer ────────────────────────────
// Handles: HTML→PDF via system Chrome, Gmail OAuth token refresh, draft creation
// Used by proxy.mjs cron job and /reports/* endpoints.

import https from "https";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = join(__dirname, "report-config.json");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ── Config persistence ────────────────────────────────────────────────────────

export function readConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); }
  catch { return {}; }
}

export function writeConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Last Wednesday of month ───────────────────────────────────────────────────

export function isLastWednesdayOfMonth(date = new Date()) {
  if (date.getDay() !== 3) return false; // 3 = Wednesday
  const nextWeek = new Date(date);
  nextWeek.setDate(date.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth();
}

export function nextLastWednesday() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  // Walk forward until we find the next last-Wednesday
  for (let i = 0; i < 60; i++) {
    d.setDate(d.getDate() + (i === 0 ? 0 : 1));
    if (isLastWednesdayOfMonth(d) && d > new Date()) return new Date(d);
  }
  return null;
}

// ── Gmail OAuth helpers ───────────────────────────────────────────────────────

function httpsPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST", headers: { "Content-Length": Buffer.byteLength(data), ...headers } },
      res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function exchangeCodeForTokens(code, clientId, clientSecret, redirectUri) {
  const body = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: "authorization_code",
  }).toString();
  const r = await httpsPost("oauth2.googleapis.com", "/token", body, { "Content-Type": "application/x-www-form-urlencoded" });
  return JSON.parse(r.body);
}

export async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const body = new URLSearchParams({
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
    grant_type: "refresh_token",
  }).toString();
  const r = await httpsPost("oauth2.googleapis.com", "/token", body, { "Content-Type": "application/x-www-form-urlencoded" });
  const parsed = JSON.parse(r.body);
  if (!parsed.access_token) throw new Error("Token refresh failed: " + r.body);
  return parsed.access_token;
}

// ── HTML → PDF via puppeteer-core + system Chrome ────────────────────────────

export async function htmlToPdf(html) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

// ── Build RFC-2822 MIME message with PDF attachment ───────────────────────────

function buildMime({ from, to, subject, htmlBody, pdfBuffer, pdfFilename }) {
  const boundary = `boundary_${Date.now()}_radical`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(htmlBody).toString("base64"),
    "",
    `--${boundary}`,
    "Content-Type: application/pdf",
    `Content-Disposition: attachment; filename="${pdfFilename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    pdfBuffer.toString("base64"),
    "",
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

// ── Create Gmail draft ────────────────────────────────────────────────────────

export async function createGmailDraft({ accessToken, to, subject, htmlBody, pdfBuffer, pdfFilename }) {
  const mime = buildMime({ from: "me", to, subject, htmlBody, pdfBuffer, pdfFilename });
  const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const bodyStr = JSON.stringify({ message: { raw } });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "gmail.googleapis.com",
      path: "/gmail/v1/users/me/drafts",
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    }, res => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Generate report HTML (server-side, mirrors App.jsx handleDownload) ────────

export function generateReportHTML(company, dateStr) {
  const run   = company.runs?.[0];
  const media  = run?.mediaResults  || [];
  const social = run?.socialResults || [];
  const sov    = company.sovRun;
  const sent   = run?.sentimentScore ?? null;
  const sentColor = sent === null ? "#6b7280" : sent > 0.2 ? "#16a34a" : sent < -0.2 ? "#dc2626" : "#d97706";

  const topArticles = media.slice(0, 10).map(a => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 10px;font-size:12px;color:#111;font-weight:600">${(a.title||"").replace(/</g,"&lt;").slice(0,120)}</td>
      <td style="padding:8px 10px;font-size:11px;color:#6b7280;white-space:nowrap">${a.source?.name||""}</td>
      <td style="padding:8px 10px;font-size:11px;color:#6b7280;white-space:nowrap">${(a.publishedAt||"").slice(0,10)}</td>
      <td style="padding:8px 10px;font-size:11px;font-weight:700;color:${
        (a.sentiment||0)>0.15?"#16a34a":(a.sentiment||0)<-0.15?"#dc2626":"#d97706"
      }">${((a.sentiment||0)>=0?"+":"")}${(a.sentiment||0).toFixed(2)}</td>
    </tr>`).join("");

  // SOV table
  let sovTableHTML = "";
  if (sov?.results?.length) {
    const palette = ["#818cf8","#34d399","#f59e0b","#f87171","#60a5fa","#a78bfa","#4ade80","#fb923c"];
    let peer = 1;
    const colored = [...sov.results].sort((a,b)=>(b.mediaCount||0)-(a.mediaCount||0))
      .map(r => ({ ...r, color: r.isBase ? palette[0] : palette[peer++ % palette.length] }));
    const totalMedia  = colored.reduce((s,r)=>s+(r.mediaCount||0),0);
    const totalSocial = colored.reduce((s,r)=>s+(r.socialCount||0),0);
    sovTableHTML = `
      <h2 style="font-size:13px;font-weight:800;color:#111;margin:28px 0 12px;text-transform:uppercase;letter-spacing:0.05em">Share of Voice</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:2px solid #111">
          <th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Company</th>
          <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Press</th>
          <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Press SOV</th>
          <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Social</th>
          <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Sentiment</th>
          <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">#</th>
        </tr></thead>
        <tbody>
          ${colored.map((r,i) => `<tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:8px 8px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px"></span><strong style="color:${r.isBase?"#111":"#374151"}">${r.name}${r.isBase?" ★":""}</strong></td>
            <td style="text-align:right;padding:8px 8px;font-weight:600">${r.mediaCount||0}</td>
            <td style="text-align:right;padding:8px 8px;color:#6b7280">${totalMedia>0?Math.round((r.mediaCount||0)/totalMedia*100)+"%" : "—"}</td>
            <td style="text-align:right;padding:8px 8px">${r.socialCount||0}</td>
            <td style="text-align:right;padding:8px 8px;font-weight:700;color:${r.sentiment>0.15?"#16a34a":r.sentiment<-0.15?"#dc2626":"#d97706"}">${(r.sentiment>=0?"+":"")}${(r.sentiment||0).toFixed(2)}</td>
            <td style="text-align:right;padding:8px 8px;color:#9ca3af">#${i+1}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${sov.aiSummary ? `<div style="margin-top:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px"><div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">AI Competitive Analysis</div><p style="font-size:12px;color:#374151;line-height:1.75;white-space:pre-wrap;margin:0">${sov.aiSummary.replace(/</g,"&lt;")}</p></div>` : ""}
    `;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${company.name} - Radical Brand Intelligence Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 28px; color: #111; background: #fff; font-size: 13px; }
  @media print { body { margin: 0; } }
  table { width: 100%; border-collapse: collapse; }
</style>
</head><body>

<div style="border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between">
    <div>
      <h1 style="font-size:22px;font-weight:900;margin:0;letter-spacing:-0.03em">${company.name} — Radical Brand Intelligence Report</h1>
      <p style="color:#6b7280;font-size:12px;margin:5px 0 0">Prepared by Radical Ventures · ${dateStr}</p>
      ${(company.categories||[]).length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${(company.categories||[]).map(c=>`<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-weight:600">${c}</span>`).join("")}</div>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af;flex-shrink:0">
      ${run ? `${run.mediaCount||0} articles · ${run.socialCount||0} posts<br>${run.fromDate||""} → ${(run.ranAt||"").slice(0,10)}` : "No run data"}
    </div>
  </div>
</div>

${sent !== null ? `
<div style="margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap">
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;min-width:140px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Sentiment</div>
    <div style="font-size:28px;font-weight:900;color:${sentColor}">${sent>=0?"+":""}${sent.toFixed(2)}</div>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;min-width:140px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Press Articles</div>
    <div style="font-size:28px;font-weight:900;color:#111">${run?.mediaCount||0}</div>
  </div>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;min-width:140px">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">Social Posts</div>
    <div style="font-size:28px;font-weight:900;color:#111">${run?.socialCount||0}</div>
  </div>
</div>` : ""}

${topArticles ? `
<h2 style="font-size:13px;font-weight:800;color:#111;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em">Top Articles</h2>
<table>
  <thead><tr style="border-bottom:2px solid #111">
    <th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Headline</th>
    <th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Source</th>
    <th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Date</th>
    <th style="text-align:right;padding:6px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase">Sent.</th>
  </tr></thead>
  <tbody>${topArticles}</tbody>
</table>` : ""}

${sovTableHTML}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Radical Intelligence Platform · Radical Ventures · ${dateStr} · Automated monthly report
</div>

</body></html>`;
}
