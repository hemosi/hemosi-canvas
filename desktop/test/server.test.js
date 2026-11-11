// Smoke test for desktop/server.js: static serving, SPA fallback, path traversal guard and the /__proxy forwarder.
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createAppServer, listen, readProxyTarget } = require("../server");

(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hemosi-dist-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>Hemosi</title>");
    fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log(1)");

    const upstream = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            res.writeHead(201, { "content-type": "application/json", "access-control-allow-origin": "https://evil" });
            res.end(JSON.stringify({ method: req.method, url: req.url, body, auth: req.headers.authorization || "" }));
        });
    });
    const upstreamPort = await listen(upstream, 0);
    const app = createAppServer({ root });
    const port = await listen(app, 0);
    const base = `http://127.0.0.1:${port}`;

    let r = await fetch(`${base}/`);
    assert.strictEqual(r.status, 200);
    assert.match(await r.text(), /Hemosi/);
    r = await fetch(`${base}/canvas/abc`);
    assert.strictEqual(r.status, 200, "SPA fallback");
    assert.match(r.headers.get("content-type"), /text\/html/);
    r = await fetch(`${base}/assets/app.js`);
    assert.match(r.headers.get("content-type"), /javascript/);
    r = await fetch(`${base}/assets/missing.js`);
    assert.strictEqual(r.status, 404);
    r = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`);
    assert.notStrictEqual(await r.text().then((t) => t.includes("root:")), true, "no traversal");

    r = await fetch(`${base}/__proxy/http://127.0.0.1:${upstreamPort}/v1/images/generations?x=1`, { method: "POST", headers: { authorization: "Bearer k", "content-type": "application/json" }, body: '{"a":1}' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.headers.get("access-control-allow-origin"), "*");
    const echoed = await r.json();
    assert.deepStrictEqual(echoed, { method: "POST", url: "/v1/images/generations?x=1", body: '{"a":1}', auth: "Bearer k" });
    r = await fetch(`${base}/__proxy/x`, { method: "OPTIONS" });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(readProxyTarget("/__proxy/https:/api.x.com/v1"), "https://api.x.com/v1");
    assert.strictEqual(readProxyTarget("/__proxy/ftp://x"), "");

    app.close();
    upstream.close();
    console.log("server.test.js: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
