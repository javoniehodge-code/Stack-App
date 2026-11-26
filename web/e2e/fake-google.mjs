// A stand-in for Google's sign-in servers, for the isolated test environment only. Supabase Auth has Google's
// addresses built in, so the local Auth server is started with HTTPS_PROXY pointing here and SSL_CERT_FILE
// trusting a throwaway test CA: its requests to accounts.google.com, oauth2.googleapis.com and www.googleapis.com
// arrive here, over TLS with a certificate from that CA. Nothing else is proxied (other hosts are refused).
//
// It answers the three things Auth asks Google for: the OpenID configuration, the signing keys, and the token
// exchange. The browser side (Google's consent screen) is played by the test itself, which sends the browser
// back to Auth's callback with a code made by fakeGoogleCode() below. The code carries the Google account the
// test wants to sign in as; the token endpoint turns it into an ID token signed with this file's key.
//
//   node web/e2e/fake-google.mjs <port> <leaf cert.pem> <leaf key.pem> <client id>
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [port, certFile, keyFile, clientId] = process.argv.slice(2);
if (!port || !certFile || !keyFile || !clientId) {
  console.error("usage: fake-google.mjs <port> <cert.pem> <key.pem> <client id>");
  process.exit(2);
}
const HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com", "openidconnect.googleapis.com"]);
const ISSUER = "https://accounts.google.com";
const kid = randomUUID();
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function signJwt(claims) {
  const head = b64url({ alg: "RS256", kid, typ: "JWT" }) + "." + b64url(claims);
  return head + "." + createSign("RSA-SHA256").update(head).sign(privateKey).toString("base64url");
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function google(req, res) {
  const host = (req.headers.host || "").split(":")[0];
  const url = new URL(req.url, `https://${host}`);
  console.log(`${req.method} ${host}${url.pathname}`);
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }
  if (url.pathname === "/oauth2/v3/certs") return json(res, 200, { keys: [jwk] });
  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      let who;
      try {
        who = JSON.parse(Buffer.from(form.get("code") || "", "base64url").toString());
      } catch {
        return json(res, 400, { error: "invalid_grant" });
      }
      if (!who?.email) return json(res, 400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt({
        iss: ISSUER,
        aud: clientId,
        azp: clientId,
        sub: who.sub || `google-${who.email}`,
        email: who.email,
        email_verified: true,
        name: who.name || "Test Person",
        picture: "",
        iat: now,
        exp: now + 3600,
      });
      json(res, 200, { access_token: `fake-access-${randomUUID()}`, token_type: "Bearer", expires_in: 3600, id_token: idToken, scope: "openid email profile" });
    });
    return;
  }
  json(res, 404, { error: "not_found" });
}

const tls = createTlsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, google);

// The proxy: CONNECT to a Google host is answered by the TLS server above; anything else is refused.
const proxy = createServer((req, res) => {
  res.writeHead(403);
  res.end("fake-google proxy: only CONNECT to Google hosts");
});
proxy.on("connect", (req, socket) => {
  const host = (req.url || "").split(":")[0];
  if (!HOSTS.has(host)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  tls.emit("connection", socket);
});
proxy.listen(Number(port), "127.0.0.1", () => console.log(`fake Google on 127.0.0.1:${port}`));
