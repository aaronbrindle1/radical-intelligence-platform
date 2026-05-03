// ─── Radical Intelligence — Local API Proxy ───────────────────────────────────
// Port 3001. Forwards API calls from the browser to avoid CORS restrictions.
// Routes: /newsapi/* /yutori/* /cohere/* /anthropic/*
// Start: node proxy.mjs  (launched automatically by START-MAC.command)

import http from "http";
import https from "https";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { execSync } from "child_process";
import { getCache, setCache } from "./src/cache.js";

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

const server = http.createServer((req, res) => {

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Client-Name, anthropic-version, x-api-key",
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
    
    // Parse region from path if possible, default to us-central1
    // Path looks like: v1/projects/PROJECT/locations/REGION/...
    const regionMatch = path.match(/locations\/([a-z0-9-]+)/);
    const region = regionMatch ? regionMatch[1] : "us-central1";
    
    // Try to get token from Authorization header first
    let token = req.headers["authorization"];
    if (!token) {
      // Fallback: try gcloud
      try {
        token = "Bearer " + execSync("gcloud auth print-access-token").toString().trim();
        console.log("[proxy] Successfully retrieved Vertex AI token via gcloud");
      } catch (e) {
        console.warn("[proxy] Failed to get Vertex AI token via gcloud (is it installed and logged in?):", e.message);
      }
    }
    
    if (!token) {
      res.writeHead(401, { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No Vertex AI token found. Run 'gcloud auth login' and 'gcloud auth application-default login' first." }));
      return;
    }

    const targetUrl = `https://${region}-aiplatform.googleapis.com/${path}`;
    proxyRequest(req, res, targetUrl, {
      "Authorization": token
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

  // ── Health check ─────────────────────────────────────────────────────────
  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", proxy: "Radical Intelligence", port: PORT }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unknown proxy path: " + url }));
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║   Radical Intelligence — API Proxy  (port ${PORT})             ║
║                                                               ║
║   /newsapi/*        → newsapi.org                             ║
║   /yutori/*         → api.yutori.com                          ║
║   /data365/*        → api.data365.co                          ║
║   /cohere/*         → radical.cloud.cohere.com                ║
║   /cohere-public/*  → api.cohere.ai                           ║
║   /anthropic/*      → api.anthropic.com                       ║
║   /gemini/*         → generativelanguage.googleapis.com       ║
║                                                               ║
║   All API keys passed from browser headers / URLs             ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
