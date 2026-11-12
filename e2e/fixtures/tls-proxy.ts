/**
 * A local https front for the production build (feature 002 QA, AC-3(a)): terminates TLS with a self-signed
 * certificate made at start (openssl), keeps the Host header and adds x-forwarded-proto=https, and pipes to
 * `next start` on TLS_PROXY_TARGET. Test-only; never used by the app.
 */
import { createServer, request } from "node:http";
import { createServer as createTls } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.TLS_PROXY_PORT ?? 3443);
const target = new URL(process.env.TLS_PROXY_TARGET ?? "http://127.0.0.1:3103");
const dir = mkdtempSync(join(tmpdir(), "vidalo-tls-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });

createTls({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
  const up = request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https" } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.rawHeaders);
      r.pipe(res);
    },
  );
  up.on("error", () => {
    res.writeHead(502);
    res.end("upstream down");
  });
  req.pipe(up);
}).listen(port, "127.0.0.1");

// Plain health endpoint for Playwright's webServer wait (it cannot ignore a self-signed certificate).
createServer((_req, res) => res.end("ok")).listen(port + 1, "127.0.0.1");
