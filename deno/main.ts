// ==============================================================================
// VibzCode Sovereign Edge Gateway & Deno Deploy Entrypoint
// Proxies API, Remote MCP, WebSockets & Serves Modern Web Interface
// ==============================================================================

import { Hono } from "jsr:@hono/hono@^4.12";
import { cors } from "jsr:@hono/hono@^4.12/cors";
import { logger } from "jsr:@hono/hono@^4.12/logger";

const app = new Hono();

// Configuration
const BACKEND_BASE_URL = (
  Deno.env.get("BACKEND_BASE_URL") ||
  (Deno.env.get("DENO_DEPLOYMENT_ID") ? "http://145.241.104.205:3333" : "http://127.0.0.1:3333")
).replace(/\/$/, "");
const BACKEND_AUTH_SECRET = Deno.env.get("BACKEND_AUTH_SECRET") || "";
const PORT = parseInt(Deno.env.get("PORT") || "8000");

// MIME Types for Static Assets
const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=UTF-8",
  css: "text/css; charset=UTF-8",
  js: "application/javascript; charset=UTF-8",
  json: "application/json; charset=UTF-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=UTF-8"
};

// Global Middleware
app.use("*", logger());
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowHeaders: ["*"],
  exposeHeaders: ["mcp-session-id", "Content-Type", "Authorization", "X-API-Key"],
  maxAge: 86400
}));

// Security Headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Powered-By", "VibzCode Deno Edge Gateway");
});

// ==============================================================================
// 1. WEBSOCKET PROXY (Live Interactive Terminal across Edge)
// ==============================================================================
function handleWebSocketProxy(c: any): Response {
  const req = c.req.raw;
  const upgrade = req.headers.get("upgrade");
  if (upgrade?.toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
  const url = new URL(req.url);
  const targetWsUrl = BACKEND_BASE_URL.replace(/^http/, "ws") + url.pathname + url.search;

  console.log(`[Edge WS] Upgrading client connection -> ${targetWsUrl}`);

  try {
    const backendWs = new WebSocket(targetWsUrl);

    backendWs.onopen = () => {
      console.log(`[Edge WS] Connected to backend VPS`);

      // Forward client to backend
      clientWs.onmessage = (e) => {
        if (backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(e.data);
        }
      };

      // Forward backend to client
      backendWs.onmessage = (e) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(e.data);
        }
      };
    };

    clientWs.onclose = (ev) => {
      console.log(`[Edge WS] Client closed (code: ${ev.code})`);
      try { backendWs.close(ev.code, ev.reason); } catch (_) {}
    };

    backendWs.onclose = (ev) => {
      console.log(`[Edge WS] Backend closed (code: ${ev.code})`);
      try { clientWs.close(ev.code, ev.reason); } catch (_) {}
    };

    clientWs.onerror = (e) => {
      console.error(`[Edge WS] Client error:`, e);
      try { backendWs.close(); } catch (_) {}
    };

    backendWs.onerror = (e) => {
      console.error(`[Edge WS] Backend error:`, e);
      try { clientWs.close(); } catch (_) {}
    };
  } catch (err: any) {
    console.error(`[Edge WS] Failed to initiate backend WebSocket:`, err.message);
  }

  return response;
}

// Upgrade WebSocket on root path or /ws
app.get("/ws", handleWebSocketProxy);

// ==============================================================================
// 2. EDGE GATEWAY HEALTH & DIAGNOSTICS
// ==============================================================================
app.get("/health", async (c) => {
  const start = Date.now();
  let backendOk = false;
  let pingMs = 0;

  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/api/admin/login`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(3000)
    });
    backendOk = resp.status < 500;
    pingMs = Date.now() - start;
  } catch (_) {
    backendOk = false;
  }

  return c.json({
    status: "healthy",
    gateway: "VibzCode Deno Edge Gateway",
    deployment: Deno.env.get("DENO_DEPLOYMENT_ID") ? "deno_deploy" : "local_deno",
    region: Deno.env.get("DENO_REGION") || "edge",
    backend: {
      url: BACKEND_BASE_URL.replace(/(:\/\/)(.*)(:[0-9]+)/, "$1***$3"),
      connected: backendOk,
      latency_ms: pingMs
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", async (c) => {
  return c.redirect("/health");
});

// ==============================================================================
// 3. REMOTE MCP PROXY (ChatGPT, Gemini, Claude, Cursor Support)
// ==============================================================================
async function handleMcpProxy(c: any): Promise<Response> {
  const req = c.req.raw;
  const url = new URL(req.url);
  const targetUrl = `${BACKEND_BASE_URL}${url.pathname}${url.search}`;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, mcp-session-id, Last-Event-ID",
        "Access-Control-Expose-Headers": "mcp-session-id, Content-Type, WWW-Authenticate"
      }
    });
  }

  // Clone headers
  const fwdHeaders = new Headers(req.headers);
  fwdHeaders.delete("host");
  fwdHeaders.set("x-forwarded-host", url.host);
  fwdHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));

  const reqInit: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    redirect: "follow"
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    reqInit.body = req.body;
    // @ts-ignore: duplex is required for streaming bodies in fetch
    reqInit.duplex = "half";
  }

  try {
    const backendResp = await fetch(targetUrl, reqInit);
    const respHeaders = new Headers(backendResp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Access-Control-Expose-Headers", "mcp-session-id, Content-Type, WWW-Authenticate");

    // Rewrite backend IP/domain in JSON metadata responses to edge domain
    const contentType = respHeaders.get("content-type") || "";
    if (contentType.includes("application/json") && req.method === "GET") {
      const jsonText = await backendResp.text();
      const originHost = `${url.protocol}//${url.host}`;
      const rewrittenText = jsonText
        .replace(/https?:\/\/127\.0\.0\.1:3333/g, originHost)
        .replace(/https?:\/\/localhost:3333/g, originHost)
        .replace(/https?:\/\/145\.241\.104\.205:3333/g, originHost)
        .replace(/https?:\/\/145\.241\.104\.205/g, originHost);

      return new Response(rewrittenText, {
        status: backendResp.status,
        headers: respHeaders
      });
    }

    // Stream SSE or JSON-RPC responses directly
    return new Response(backendResp.body, {
      status: backendResp.status,
      statusText: backendResp.statusText,
      headers: respHeaders
    });
  } catch (err: any) {
    return c.json({
      jsonrpc: "2.0",
      error: { code: -32603, message: `MCP Edge Gateway Proxy Error: ${err.message}` },
      id: null
    }, 502);
  }
}

app.all("/mcp", handleMcpProxy);
app.all("/mcp/*", handleMcpProxy);
app.all("/.well-known/*", handleMcpProxy);

// ==============================================================================
// 4. API REVERSE PROXY (/api/* -> Backend VPS)
// ==============================================================================
app.all("/api/*", async (c) => {
  const req = c.req.raw;
  const url = new URL(req.url);
  const targetUrl = `${BACKEND_BASE_URL}${url.pathname}${url.search}`;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key"
      }
    });
  }

  const fwdHeaders = new Headers(req.headers);
  fwdHeaders.delete("host");
  fwdHeaders.set("x-forwarded-host", url.host);
  fwdHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));

  if (BACKEND_AUTH_SECRET && !fwdHeaders.has("authorization")) {
    fwdHeaders.set("authorization", `Bearer ${BACKEND_AUTH_SECRET}`);
  }

  const reqInit: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    redirect: "follow"
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    reqInit.body = req.body;
    // @ts-ignore: duplex is required for streaming body
    reqInit.duplex = "half";
  }

  try {
    const backendResp = await fetch(targetUrl, reqInit);
    const respHeaders = new Headers(backendResp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(backendResp.body, {
      status: backendResp.status,
      statusText: backendResp.statusText,
      headers: respHeaders
    });
  } catch (err: any) {
    return c.json({
      success: false,
      error: `Edge Proxy Connection Error: Unable to reach backend server at ${BACKEND_BASE_URL}. (${err.message})`,
      targetUrl
    }, 502);
  }
});

// ==============================================================================
// 5. STATIC ASSETS & FRONTEND SERVING
// ==============================================================================
async function serveStatic(filePath: string): Promise<Response | null> {
  try {
    const clean = filePath.replace(/^(\.\.[\/\\])+/, "").replace(/^\/+/, "");
    const fileUrl = new URL(`./public/${clean}`, import.meta.url);
    const fileData = await Deno.readFile(fileUrl);
    const ext = clean.split(".").pop()?.toLowerCase() || "";
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    const isHtml = ext === "html";
    const cacheControl = isHtml ? "no-cache, must-revalidate" : "public, max-age=86400, immutable";

    return new Response(fileData, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": cacheControl
      }
    });
  } catch (_) {
    return null;
  }
}

// Root path: check if WebSocket upgrade first, else serve index.html
app.get("/", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocketProxy(c);
  }
  const html = await serveStatic("index.html");
  if (html) return html;
  return c.text("VibzCode Edge Dashboard is initializing...", 200);
});

// Dedicated Agent Session Interface
app.get("/agent.html", async () => {
  const html = await serveStatic("agent.html");
  if (html) return html;
  return new Response("Not found", { status: 404 });
});

app.get("/agent", (c) => {
  const url = new URL(c.req.url);
  return c.redirect(`/agent.html${url.search}`);
});

// Fallback for all other static paths (CSS, JS, fonts)
app.get("*", async (c) => {
  const pathname = c.req.path;
  const staticResp = await serveStatic(pathname);
  if (staticResp) return staticResp;

  // Fallback to index.html for SPA routes if not found
  const indexResp = await serveStatic("index.html");
  if (indexResp) return indexResp;

  return c.text("404 Not Found", 404);
});

// Start Deno HTTP Server
console.log(`=======================================================`);
console.log(`⚡ VibzCode Edge Gateway running on http://localhost:${PORT}`);
console.log(`🎯 Proxied Backend: ${BACKEND_BASE_URL}`);
console.log(`📡 Remote MCP: /mcp & /mcp/orchestrator`);
console.log(`=======================================================`);

Deno.serve({ port: PORT }, app.fetch);
