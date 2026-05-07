// ─── Radical Intelligence — Local API Proxy ───────────────────────────────────
// Port 3001. Forwards API calls from the browser to avoid CORS restrictions.
// Routes: /newsapi/* /yutori/* /cohere/* /anthropic/* /vertex/*
// Start: node proxy.mjs  (launched automatically by START-MAC.command)

import http from "http";
import https from "https";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { execSync } from "child_process";
import { getCache, setCache, bustNewsCache } from "./src/cache.js";
import cron from "node-cron";
import {
  readConfig, writeConfig, isLastWednesdayOfMonth, nextLastWednesday,
  exchangeCodeForTokens, refreshAccessToken, htmlToPdf, createGmailDraft, generateReportHTML,
} from "./report-mailer.mjs";

// ── Service Account JWT Token Cache ──────────────────────────────────────────
let _vertexTokenCache = null;

function getServiceAccountKey() {
  // Embedded service account key — no file needed
  return {
    type: "service_account",
    project_id: "velvety-argon-494701-g1",
    private_key_id: "92101fd1bb45dbbaf0b1648cc8f5d9fe2bdaedd6",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDUr234w9RXud2N\n32uSJw+bmZWn+nUoc3X8+23yC9LCXSkr2jIoB547ONJS4S/OavqyMxr9WS65ORJi\n5adK6pJacb1fjx4oTx0JhFjKboJDQs9XxKdwD+BTgsGdrrLHyPzgsK9LlKRuyLTJ\nex+T5XQPXUlH09D2QPlmGzgX9wxSAIpeKDQ53uBhJ/cPDqnP1sIfEmxAsGJmLDOs\nEgFefaBalyBE4Us/fYG+JP9RePbn6irrQz9hVoMcAEiSIW+0W/EtsxqABymo734v\nEtvBgGsofHudj8hlqjgQ90SdYSbf38TYg2IpYdpRK5nY87cZpC7264oJBtCml7lS\n9HkgFPUdAgMBAAECggEAI98gx7PTxSYKmaqknIZtCfvp82Z5SyTKMix/+zKGThTj\nZEuNaRX72JY5VxQ2+XQuq06WT0Oy7zeSg86jHC4bGBkV7R+Y4QiS56+EQERKQSjs\nCqwW534uAjfMCxnTeoHKMOVr823zG+JLJ65WAZ5SKGM+AFjX5ijIR7HwkI4w7EVv\nT94pWEXOfL8LVUY7TngT6njMc5exe1o4HI4AI1X6q1QFU12D6Ebk6Fr+vcB19pKJ\nza6/x/7K/LpyjftOWDocoSk2LDB45ABdP79AF307z9sU5hVQSfwFv+uEhw4wusNE\nNTScYLjGufi/usd4NtyHaJApOBjd7pbdiBTKC2Gf4QKBgQDxKGsVPTI4yzmCstsp\nYGsC3UvY2+2htqytWcJhzqlNY+jqRO5OsQl4VHiIWoISifb7HIaB1mb+bSFIW7yw\ns11xXb2ibdrgFu7G2EA4tr12SwpY7zeOKhOzUkO9n5DmXq9ntiwbWBh4DO1nt1Qw\n7ZiTpAwRNmpefMGuqIBU4lE1cQKBgQDhxmipsbyJU2dEbEjLp5BI6GJmCX69yhq7\nm0Y3QKpelTT23jheK2EHlsTE26F+78cDAsbZwfNf9lg5ykMoC7HyaehaShb0gQJL\n/VUOGA86LluqDzrdCo/7YkBpTGzje7Yu9xUDgbGGPXIvgIRYjPP9IGrF+Xu7TdHq\nlyF3/up0bQKBgGs3Tgx+TaLEb4g1Ho0RyeHXI06B0O+RuMnFW0+CwvCeV8I37T9d\nJFm0LHZqzuORJRZVg1OcT+QT/rUd3BEvXX72b0YU0zfH2lbbdAoC7M7349zQVgHF\noUabb3SRyakyNYfFjWyGyTIuhSoUbsDmEWyqhZbte3MQwkd1sMCMchBxAoGBAM8i\nVpeJBu3+ZLmzlr2xB4C8Irp2b57zsr73392FKEkKHsN2cMSEi8qImhH5ZhqtJSov\n+/uAIyahPaQXWrF8uU8rtw5O9uxvB4pr6wK5NA8uxM4qltiAfkQlie6RPT0fHK/N\n46uJ6zK7YO0PvVv4RUiv2wWys7/Nz46oBP6wEq2pAoGBAOfQXmM69P0TmK4fLAnX\nzTdO+pmDAcF8OqDbxx2371W1XcHaMvDOWdmVkii+kqPNPFT6/5jm/Ii01MHyx2S2\nA8vsMFm6+r9blV5ExHteRf8hVBnzORT24tWm0Yrm+FnmdQXjUEFLT5cZc14W09TY\nsrojf7gjraB8C6I52Xi9AF3Z\n-----END PRIVATE KEY-----\n",
    client_email: "vertex-shared-user@velvety-argon-494701-g1.iam.gserviceaccount.com",
    client_id: "115646283547700834700",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function base64url(str) {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getVertexToken() {
  // Return cached token if still valid (refresh 5 min before expiry)
  if (_vertexTokenCache && _vertexTokenCache.expiresAt > Date.now() + 300_000) {
    return _vertexTokenCache.token;
  }

  const key = getServiceAccountKey();
  if (!key) return null;

  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: key.token_uri,
    exp: now + 3600,
    iat: now,
  }));

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(header + "." + payload);
  const sig = sign.sign(key.private_key, "base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = header + "." + payload + "." + sig;

  // Exchange JWT for access token
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(d);
          if (r.access_token) {
            _vertexTokenCache = { token: "Bearer " + r.access_token, expiresAt: Date.now() + (r.expires_in * 1000) };
            console.log("[vertex] ✅ Service account token obtained, expires in", r.expires_in, "s");
            resolve(_vertexTokenCache.token);
          } else {
            console.warn("[vertex] ❌ Token exchange failed:", JSON.stringify(r));
            resolve(null);
          }
        } catch(e) { console.warn("[vertex] Token parse error:", e.message); resolve(null); }
      });
    });
    req.on("error", e => { console.warn("[vertex] Token request error:", e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ALLOWED_ORIGIN = "http://localhost:3000";

function readEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return {};
  const env = {};
  readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [k, ...v] = line.split("=");
    if (k && !k.startsWith("#")) env[k.trim()] = v.join("=").trim();
  });
  return env;
}

function generateCacheKey(method, url, bodyBuffer) {
  const hash = crypto.createHash('sha256');
  hash.update(method);
  hash.update(url);
  if (bodyBuffer) hash.update(bodyBuffer);
  return hash.digest('hex');
}

function proxyRequest(req, res, targetUrl, extraHeaders = {}, body = null, redirectCount = 0) {
  if (redirectCount > 5) {
    res.writeHead(508, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many redirects" }));
    return;
  }

  const target = new URL(targetUrl);
  const options = {
    hostname: target.hostname,
    port: target.port || 443,
    path: target.pathname + target.search,
    method: req.method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  };

  const cacheKey = generateCacheKey(req.method, targetUrl, body);
  const isCacheable = (req.method === "GET" || targetUrl.includes("/chat") || targetUrl.includes(":generateContent")) 
                      && !targetUrl.includes("/tasks/");

  if (isCacheable) {
    const cached = getCache(cacheKey);
    if (cached) {
      console.log(`[cache] HIT: ${targetUrl}`);
      res.writeHead(200, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Cache": "HIT"
      });
      res.end(cached);
      return;
    }
  }

  console.log(`[proxy] Forwarding to: https://${options.hostname}${options.path}`);

  const doRequest = (requestBody) => {
    const proxy = https.request(options, proxyRes => {
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        const redirectUrl = proxyRes.headers.location.startsWith("http")
          ? proxyRes.headers.location
          : `https://${url.hostname}${proxyRes.headers.location}`;
        console.log(`[proxy] Following redirect ${proxyRes.statusCode} → ${redirectUrl}`);
        // Consume the redirect response body
        proxyRes.resume();
        proxyRequest(req, res, redirectUrl, extraHeaders, requestBody, redirectCount + 1);
        return;
      }

      res.writeHead(proxyRes.statusCode, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "*",
        "Content-Type": proxyRes.headers["content-type"] || "application/json",
        "X-Cache": "MISS"
      });
      
      if (proxyRes.statusCode === 200 && isCacheable) {
        const chunks = [];
        proxyRes.on("data", c => chunks.push(c));
        proxyRes.on("end", () => {
          const buffer = Buffer.concat(chunks);
          res.end(buffer);
          setCache(cacheKey, buffer.toString("utf8"));
        });
      } else {
        proxyRes.pipe(res);
      }
    });

    proxy.on("error", e => {
      console.error("[proxy] Error:", e.message);
      res.writeHead(502, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error: " + e.message }));
    });

    if (requestBody) {
      proxy.write(requestBody);
      proxy.end();
    } else if (req.method !== "GET" && req.method !== "HEAD" && !body) {
      req.pipe(proxy);
    } else {
      proxy.end();
    }
  };

  // For redirected POST requests, we need to buffer the body first
  if (body) {
    doRequest(body);
  } else if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const requestBody = Buffer.concat(chunks);
      doRequest(requestBody);
    });
  } else {
    doRequest(null);
  }
}

const server = http.createServer(async (req, res) => {

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Client-Name, anthropic-version, x-api-key, x-twitter-key",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  const env = readEnv();
  const url = req.url;
  console.log(`[proxy] ${req.method} ${url}`);

  // ── NewsAPI ──────────────────────────────────────────────────────────────
  // The browser passes the API key as a query param — proxy just forwards it
  if (url.startsWith("/newsapi/")) {
    const path = url.replace("/newsapi/", "");
    proxyRequest(req, res, `https://newsapi.org/${path}`);
    return;
  }

  // ── Yutori ───────────────────────────────────────────────────────────────
  if (url.startsWith("/yutori/")) {
    const path = url.replace("/yutori/", "");
    const key = req.headers["x-api-key"] || env.VITE_YUTORI_API_KEY || "";
    proxyRequest(req, res, `https://api.yutori.com/${path}`, { "X-API-Key": key });
    return;
  }

  // ── Data365 ──────────────────────────────────────────────────────────────
  if (url.startsWith("/data365/")) {
    const path = url.replace("/data365/", "");
    proxyRequest(req, res, `https://api.data365.co/${path}`);
    return;
  }

  // ── TwitterAPI.io ─────────────────────────────────────────────────────────
  if (url.startsWith("/twitter/")) {
    const path = url.replace("/twitter", "");
    const twitterKey = req.headers["x-twitter-key"] || "";
    if (!twitterKey) {
      res.writeHead(401, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "x-twitter-key header required" }));
      return;
    }
    console.log(`[twitter] key=${twitterKey.slice(0,8)}... forwarding to api.twitterapi.io${path.split("?")[0]}`);
    proxyRequest(req, res, `https://api.twitterapi.io${path}`, { "x-api-key": twitterKey });
    return;
  }

  // ── Cohere North ─────────────────────────────────────────────────────────
  if (url.startsWith("/cohere/")) {
    const path = url.replace("/cohere/", "");
    const authHeader = req.headers["authorization"] || "";
    const rawKey = authHeader.replace(/^Bearer /i, "") || env.VITE_COHERE_NORTH_KEY || "";
    const hostname = (env.VITE_COHERE_NORTH_HOSTNAME || "radical.cloud.cohere.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const targetUrl = `https://${hostname}/${path}`;
    console.log(`[proxy] Cohere North → ${targetUrl}`);
    console.log(`[proxy] Cohere key: ${rawKey ? rawKey.slice(0,8) + "..." : "MISSING — add in Admin → API Keys"}`);

    // Buffer the request body so we can resend on redirect
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      proxyRequest(req, res, targetUrl, {
        "Authorization": `Bearer ${rawKey}`,
        "X-Client-Name": "radical-intelligence",
        "Accept": "application/json",
      }, body);
    });
    return;
  }

  // ── Anthropic ────────────────────────────────────────────────────────────
  if (url.startsWith("/anthropic/")) {
    const path = url.replace("/anthropic/", "");
    const key = req.headers["x-api-key"] || env.VITE_ANTHROPIC_API_KEY || "";
    proxyRequest(req, res, `https://api.anthropic.com/${path}`, {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
    return;
  }

  // ── Gemini ───────────────────────────────────────────────────────────────
  if (url.startsWith("/gemini/")) {
    const path = url.replace("/gemini/", "");
    proxyRequest(req, res, `https://generativelanguage.googleapis.com/${path}`);
    return;
  }

  // ── Vertex AI ────────────────────────────────────────────────────────────
  if (url.startsWith("/vertex/")) {
    const path = url.replace("/vertex/", "");
    const regionMatch = path.match(/locations\/([a-z0-9-]+)/);
    const region = regionMatch ? regionMatch[1] : "us-central1";

    // Buffer request body before async token fetch
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);

      // Get token: header → service account key file → gcloud fallback
      let token = req.headers["authorization"];
      if (!token) {
        token = await getVertexToken();
      }
      if (!token) {
        try {
          token = "Bearer " + execSync("gcloud auth print-access-token").toString().trim();
          console.log("[vertex] Token via gcloud fallback");
        } catch(e) {
          console.warn("[vertex] gcloud fallback failed:", e.message);
        }
      }
      if (!token) {
        res.writeHead(401, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No Vertex AI credentials found. Add gcp-key.json to project root." }));
        return;
      }

      const targetUrl = `https://${region}-aiplatform.googleapis.com/${path}`;
      console.log("[vertex] → POST", targetUrl);
      console.log("[vertex] Token prefix:", token?.slice(0, 20) + "...");
      proxyRequest(req, res, targetUrl, { "Authorization": token }, body);
    });
    return;
  }

  // ── Cohere Public API ────────────────────────────────────────────────────
  if (url.startsWith("/cohere-public/")) {
    const path = url.replace("/cohere-public/", "");
    const authHeader = req.headers["authorization"] || "";
    const key = authHeader.replace(/^Bearer /i, "") || env.VITE_COHERE_API_KEY || "";
    
    // Buffer body to handle potential redirects, similar to cohere north
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      proxyRequest(req, res, `https://api.cohere.ai/${path}`, {
        "Authorization": `Bearer ${key}`,
        "Accept": "application/json",
      }, body);
    });
    return;
  }

  // ── Twitter connection test ───────────────────────────────────────────────
  if (url.startsWith("/twitter-test")) {
    const params = new URL(url, "http://localhost").searchParams;
    const twitterKey = params.get("key") || req.headers["x-twitter-key"] || "";
    if (!twitterKey) {
      res.writeHead(400, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "No API key provided" }));
      return;
    }
    const testUrl = `https://api.twitterapi.io/twitter/tweet/advanced_search?query=%22artificial+intelligence%22&queryType=Latest`;
    console.log(`[twitter-test] Calling ${testUrl} with key ${twitterKey.slice(0,8)}...`);
    const testReq = https.request(testUrl, {
      method: "GET",
      headers: { "x-api-key": twitterKey, "Content-Type": "application/json" },
    }, testRes => {
      let d = "";
      testRes.on("data", c => d += c);
      testRes.on("end", () => {
        console.log(`[twitter-test] status=${testRes.statusCode} body=${d.slice(0,200)}`);
        try {
          const body = JSON.parse(d);
          const tweetCount = (body.tweets || []).length;
          res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: testRes.statusCode === 200, status: testRes.statusCode, tweetCount, sample: (body.tweets || [])[0]?.text?.slice(0,100) || null, rawError: body.errors || body.error || null }));
        } catch {
          res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, status: testRes.statusCode, rawBody: d.slice(0,300) }));
        }
      });
    });
    testReq.on("error", e => {
      res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    testReq.end();
    return;
  }

  // ── Cache bust — DELETE /cache-bust?company=Writer ───────────────────────
  if (url.startsWith("/cache-bust") && req.method === "DELETE") {
    const params = new URL(url, "http://localhost").searchParams;
    const term = params.get("company") || "";
    if (!term) {
      res.writeHead(400, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "?company= required" }));
      return;
    }
    const deleted = bustNewsCache(term);
    console.log(`[cache] Busted ${deleted} entries for "${term}"`);
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
    res.end(JSON.stringify({ deleted, term }));
    return;
  }

  // ── Health check ─────────────────────────────────────────────────────────
  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", proxy: "Radical Intelligence", port: PORT }));
    return;
  }

  // ── Vertex diagnostics — GET /vertex-test ────────────────────────────────
  if (url === "/vertex-test") {
    const token = await getVertexToken();
    if (!token) {
      res.writeHead(500, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Could not obtain token" }));
      return;
    }
    const project = "velvety-argon-494701-g1";
    const region  = "us-central1";
    const models = ["gemini-2.5-flash","gemini-2.0-flash","gemini-2.0-flash-001","gemini-1.5-flash","gemini-1.5-flash-001","gemini-1.0-pro"];
    const tryModel = (model) => new Promise((resolve) => {
      const url2 = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:generateContent`;
      const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say ok" }] }], generationConfig: { maxOutputTokens: 10 } });
      const r = https.request(url2, { method: "POST", headers: { "Authorization": token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, resp => {
        let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve({ model, status: resp.statusCode, ok: resp.statusCode === 200 }));
      });
      r.on("error", e => resolve({ model, status: "error", ok: false }));
      r.write(body); r.end();
    });
    Promise.all(models.map(tryModel)).then(results => {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
      res.end(JSON.stringify({ tokenPrefix: token.slice(0,20), results }, null, 2));
    });
    return;
  }

  // ── Reports: save config ─────────────────────────────────────────────────
  if (url === "/reports/config" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const incoming = JSON.parse(body);
        const existing = readConfig();
        writeConfig({ ...existing, ...incoming });
        res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === "/reports/config" && req.method === "GET") {
    const cfg = readConfig();
    // Never return tokens to browser — just return safe fields
    const { gmailTokens, ...safe } = cfg;
    safe.gmailConnected = !!(gmailTokens?.refresh_token);
    safe.nextRun = nextLastWednesday()?.toISOString() || null;
    res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
    res.end(JSON.stringify(safe));
    return;
  }

  // ── Gmail OAuth callback ─────────────────────────────────────────────────
  if (url.startsWith("/gmail/callback")) {
    const params = new URL(url, "http://localhost").searchParams;
    const code = params.get("code");
    const error = params.get("error");
    if (error || !code) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2 style="font-family:sans-serif;color:#dc2626">Gmail auth failed: ${error||"no code"}</h2><script>window.close();</script></body></html>`);
      return;
    }
    try {
      const cfg = readConfig();
      const tokens = await exchangeCodeForTokens(
        code, cfg.gmailClientId, cfg.gmailClientSecret,
        `http://localhost:${PORT}/gmail/callback`
      );
      if (tokens.refresh_token) {
        writeConfig({ ...cfg, gmailTokens: { refresh_token: tokens.refresh_token, access_token: tokens.access_token } });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:#16a34a">✓ Gmail connected successfully</h2><p>You can close this window and return to the app.</p><script>setTimeout(()=>window.close(),2000);</script></body></html>`);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2 style="color:#dc2626">No refresh token received.</h2><p>Make sure you revoke previous access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> then try again.</p></body></html>`);
      }
    } catch (e) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2 style="font-family:sans-serif;color:#dc2626">Error: ${e.message}</h2><script>window.close();</script></body></html>`);
    }
    return;
  }

  // ── Gmail disconnect ─────────────────────────────────────────────────────
  if (url === "/gmail/disconnect" && req.method === "POST") {
    const cfg = readConfig();
    delete cfg.gmailTokens;
    writeConfig(cfg);
    res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Reports: manual trigger or cron trigger ──────────────────────────────
  if (url === "/reports/trigger" && req.method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { companies } = JSON.parse(body || "{}");
        const results = await runMonthlyReports(companies);
        res.writeHead(200, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, results }));
      } catch (e) {
        console.error("[reports] trigger error:", e.message);
        res.writeHead(500, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unknown proxy path: " + url }));
});

// ── Monthly report runner ─────────────────────────────────────────────────────

async function runMonthlyReports(companiesOverride) {
  const cfg = readConfig();
  const companies = companiesOverride || cfg.selectedCompanies || [];
  const recipients = cfg.recipients || [];
  const tokens = cfg.gmailTokens;

  if (!companies.length)  throw new Error("No companies selected for monthly reports");
  if (!recipients.length) throw new Error("No recipient emails configured");
  if (!tokens?.refresh_token) throw new Error("Gmail not connected — authenticate in Admin → Monthly Reports");

  const accessToken = await refreshAccessToken(tokens.refresh_token, cfg.gmailClientId, cfg.gmailClientSecret);
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const monthStr = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const results = [];
  for (const company of companies) {
    try {
      console.log(`[reports] Generating report for ${company.name}…`);
      const html = generateReportHTML(company, dateStr);
      const pdfBuffer = await htmlToPdf(html);
      const subject = `${company.name} — Radical Brand Intelligence Report — ${monthStr}`;
      const pdfFilename = `${company.name.replace(/[^a-zA-Z0-9]/g, "_")}_Report_${new Date().toISOString().slice(0,7)}.pdf`;

      for (const to of recipients) {
        const result = await createGmailDraft({ accessToken, to, subject, htmlBody: html, pdfBuffer, pdfFilename });
        console.log(`[reports] Draft created for ${company.name} → ${to}: status ${result.status}`);
        results.push({ company: company.name, to, draftId: result.body?.id, status: result.status });
      }
    } catch (e) {
      console.error(`[reports] Failed for ${company.name}:`, e.message);
      results.push({ company: company.name, error: e.message });
    }
  }
  return results;
}

// ── Cron: last Wednesday of every month at 8:00 am ───────────────────────────

cron.schedule("0 8 * * 3", async () => {
  if (!isLastWednesdayOfMonth(new Date())) return;
  console.log("[cron] Last Wednesday of month — generating monthly reports…");
  try {
    const results = await runMonthlyReports();
    console.log("[cron] Monthly reports done:", results);
  } catch (e) {
    console.error("[cron] Monthly reports failed:", e.message);
  }
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   Radical Intelligence — API Proxy  (port ${PORT})             ║
║                                                               ║
║   /newsapi/*        → newsapi.org                             ║
║   /yutori/*         → api.yutori.com                          ║
║   /data365/*        → api.data365.co                          ║
║   /twitter/*        → api.twitterapi.io (x-twitter-key hdr)  ║
║   /cohere/*         → radical.cloud.cohere.com                ║
║   /cohere-public/*  → api.cohere.ai                           ║
║   /anthropic/*      → api.anthropic.com                       ║
║   /gemini/*         → generativelanguage.googleapis.com       ║
║                                                               ║
║   All API keys passed from browser headers / URLs             ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
