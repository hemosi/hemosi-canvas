// Local HTTP server for the desktop app: serves the built web app (web/dist) and a forwarding proxy at /__proxy/<full-url>.
// The proxy is the same logic as canvas-proxy (MIT, basketikun/infinite-canvas): it lets the web app call AI provider APIs
// without CORS restrictions, so no separate proxy process is needed. It only listens on 127.0.0.1.
"use strict";

const { createServer } = require("node:http");
const { createReadStream, promises: fs } = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const PROXY_PREFIX = "/__proxy";

const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "86400",
};

const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]);
const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

/** "/__proxy/https://api.example.com/v1/x" -> "https://api.example.com/v1/x" ("" when it is not a full http(s) URL). */
function readProxyTarget(url) {
    let target = url.slice(PROXY_PREFIX.length + 1);
    try {
        target = decodeURI(target);
    } catch {
        // Malformed escape: forward the raw form.
    }
    target = target.replace(/^(https?:)\/*/i, "$1//");
    return /^https?:\/\/[^/]/i.test(target) ? target : "";
}

function requestHeaders(req) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (SKIP_REQUEST_HEADERS.has(key) || value === undefined) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    return headers;
}

function responseHeaders(upstream) {
    const headers = { ...CORS_HEADERS };
    upstream.headers.forEach((value, key) => {
        if (SKIP_RESPONSE_HEADERS.has(key) || key.startsWith("access-control-")) return;
        headers[key] = value;
    });
    return headers;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

async function forward(req, res, target) {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(target, { method: req.method, headers: requestHeaders(req), body, redirect: "follow" });
    res.writeHead(upstream.status, responseHeaders(upstream));
    if (!upstream.body) {
        res.end();
        return upstream.status;
    }
    // Streamed so SSE text generation reaches the page chunk by chunk.
    const stream = Readable.fromWeb(upstream.body);
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return upstream.status;
}

async function serveStatic(req, res, root) {
    let pathname = "/";
    try {
        pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    } catch {
        // keep "/"
    }
    const resolved = path.normalize(path.join(root, pathname));
    const inside = resolved === root || resolved.startsWith(root + path.sep);
    let file = inside ? resolved : path.join(root, "index.html");
    let stat = await fs.stat(file).catch(() => null);
    if (stat && stat.isDirectory()) {
        file = path.join(file, "index.html");
        stat = await fs.stat(file).catch(() => null);
    }
    // SPA fallback: unknown routes (/canvas/xyz, /templates, ...) get index.html; missing assets still 404.
    if (!stat && !path.extname(pathname)) {
        file = path.join(root, "index.html");
        stat = await fs.stat(file).catch(() => null);
    }
    if (!stat) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { "content-type": MIME[ext] || "application/octet-stream", "content-length": stat.size };
    // Hashed build assets can be cached; index.html must not be, so an updated install takes effect.
    headers["cache-control"] = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    createReadStream(file).pipe(res);
}

function createAppServer({ root, log = () => {} }) {
    const staticRoot = path.resolve(root);
    return createServer((req, res) => {
        const url = req.url || "/";
        if (url === PROXY_PREFIX || url.startsWith(`${PROXY_PREFIX}/`)) {
            if (req.method === "OPTIONS") {
                res.writeHead(204, CORS_HEADERS);
                res.end();
                return;
            }
            const target = readProxyTarget(url);
            if (!target) {
                sendJson(res, 200, { app: "hemosi", proxy: "built-in", usage: `${PROXY_PREFIX}/<full-target-url>` });
                return;
            }
            const startedAt = Date.now();
            forward(req, res, target)
                .then((status) => log(`${req.method} ${target} -> ${status} ${((Date.now() - startedAt) / 1000).toFixed(1)}s`))
                .catch((error) => {
                    const reason = error instanceof Error ? error.message : String(error);
                    log(`${req.method} ${target} -> failed (${reason})`);
                    if (res.headersSent) {
                        res.destroy();
                        return;
                    }
                    sendJson(res, 502, { error: reason });
                });
            return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405);
            res.end();
            return;
        }
        serveStatic(req, res, staticRoot).catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
    });
}

/** Listen on the preferred port (stable origin keeps localStorage/IndexedDB between launches); fall back to a free port. */
function listen(server, preferredPort, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
        const tryPort = (port, fallback) => {
            const onError = (error) => {
                server.off("listening", onListening);
                if (fallback && error && error.code === "EADDRINUSE") tryPort(0, false);
                else reject(error);
            };
            const onListening = () => {
                server.off("error", onError);
                resolve(server.address().port);
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(port, host);
        };
        tryPort(preferredPort, preferredPort !== 0);
    });
}

module.exports = { createAppServer, listen, readProxyTarget, PROXY_PREFIX };
