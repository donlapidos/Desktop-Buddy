// A stand-in for Microsoft's sign-in and Graph mail API, on this PC, for tests (test/outlook.test.js, the e2e
// "outlook" check). Sign-in the way Microsoft does it for a public client: an authorize page that says yes at once
// and sends the browser back with a code, PKCE S256 checked at the token endpoint, refresh tokens. Behind a bearer
// token, a mailbox with two messages and the calls Buddy makes on it. Nothing here is used by Buddy itself.
import crypto from "node:crypto";
import http from "node:http";

/** Starts it. Resolves its address, what it has seen, a way to expire the access token, and close(). */
export async function startTestMicrosoft() {
  const seen = {
    /** @type {{ redirect: string, scope: string, method: string, clientId: string }[]} */ authorized: [],
    tokens: 0, refreshes: 0, refusedTokens: 0,
    /** @type {{ method: string, path: string, body: any }[]} */ calls: [],
    /** @type {any[]} */ sent: [],
  };
  /** @type {Map<string, { challenge: string, redirect: string }>} */
  const codes = new Map();
  let access = crypto.randomBytes(12).toString("hex");
  let refreshOk = true;
  let base = "";
  const messages = [
    { id: "m1", subject: "Q3 budget", from: { emailAddress: { name: "Ana Ruiz", address: "ana@example.com" } }, toRecipients: [{ emailAddress: { address: "me@example.com" } }], receivedDateTime: "2026-11-17T09:12:00Z", bodyPreview: "The Q3 numbers are in.", body: { contentType: "text", content: "The Q3 numbers are in the Forecast sheet." }, isRead: false, hasAttachments: false, isDraft: false },
    { id: "m2", subject: "Lunch", from: { emailAddress: { name: "Sam", address: "sam@example.com" } }, toRecipients: [{ emailAddress: { address: "me@example.com" } }], receivedDateTime: "2026-11-16T12:00:00Z", bodyPreview: "Friday?", body: { contentType: "text", content: "Lunch on Friday?" }, isRead: true, hasAttachments: false, isDraft: false },
  ];
  let drafts = 0;

  const body = async (req) => {
    let s = "";
    for await (const c of req) s += c;
    return s;
  };
  const json = (res, code, value) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
  const tokens = () => ({ access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: "refresh-1", scope: "Mail.ReadWrite Mail.Send" });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", base);
    if (u.pathname === "/authorize") {
      seen.authorized.push({ redirect: u.searchParams.get("redirect_uri") ?? "", scope: u.searchParams.get("scope") ?? "", method: u.searchParams.get("code_challenge_method") ?? "", clientId: u.searchParams.get("client_id") ?? "" });
      const code = crypto.randomBytes(8).toString("hex");
      codes.set(code, { challenge: u.searchParams.get("code_challenge") ?? "", redirect: u.searchParams.get("redirect_uri") ?? "" });
      const back = new URL(u.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", u.searchParams.get("state") ?? "");
      return res.writeHead(302, { location: back.toString() }).end();
    }
    if (u.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await body(req));
      if (form.get("grant_type") === "refresh_token") {
        seen.refreshes++;
        if (!refreshOk || form.get("refresh_token") !== "refresh-1") return json(res, 400, { error: "invalid_grant", error_description: "AADSTS70008: The refresh token has expired." });
        return json(res, 200, tokens());
      }
      const issued = codes.get(form.get("code") ?? "");
      const challenge = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!issued || issued.challenge !== challenge || issued.redirect !== form.get("redirect_uri")) return json(res, 400, { error: "invalid_grant", error_description: "AADSTS50148: The code_verifier does not match." });
      codes.delete(form.get("code") ?? "");
      seen.tokens++;
      return json(res, 200, tokens());
    }
    if (u.pathname.startsWith("/graph/")) {
      if (req.headers.authorization !== `Bearer ${access}`) {
        seen.refusedTokens++;
        return json(res, 401, { error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } });
      }
      const p = u.pathname.slice("/graph".length);
      const raw = req.method === "POST" || req.method === "PATCH" ? await body(req) : "";
      const given = raw ? JSON.parse(raw) : null;
      seen.calls.push({ method: req.method ?? "", path: `${p}${u.search}`, body: given });
      if (p === "/me") return json(res, 200, { id: "me" });
      const list = p === "/me/messages" || /^\/me\/mailFolders\/[a-z]+\/messages$/.test(p);
      if (list && req.method === "GET") {
        const q = (u.searchParams.get("$search") ?? "").replace(/"/g, "").toLowerCase();
        let found = messages.filter((m) => !m.isDraft && (!q || `${m.subject} ${m.body.content} ${m.from.emailAddress.name}`.toLowerCase().includes(q)));
        if (u.searchParams.get("$filter") === "isRead eq false") found = found.filter((m) => !m.isRead);
        return json(res, 200, { value: found.slice(0, Number(u.searchParams.get("$top") ?? 10)) });
      }
      if (p === "/me/messages" && req.method === "POST") {
        const d = { ...given, id: `d${++drafts}`, isDraft: true, from: { emailAddress: { address: "me@example.com" } } };
        messages.push(d);
        return json(res, 201, d);
      }
      if (p === "/me/sendMail" && req.method === "POST") {
        seen.sent.push(given.message);
        return res.writeHead(202).end();
      }
      const one = /^\/me\/messages\/([^/]+)(\/[A-Za-z]+)?$/.exec(p);
      const m = one && messages.find((x) => x.id === decodeURIComponent(one[1]));
      if (!m) return json(res, 404, { error: { code: "ErrorItemNotFound", message: "The specified object was not found in the store." } });
      if (!one[2] && req.method === "GET") return json(res, 200, m);
      if (one[2] === "/send" && req.method === "POST") {
        if (!m.isDraft) return json(res, 400, { error: { message: "Not a draft." } });
        seen.sent.push(m);
        return res.writeHead(202).end();
      }
      if ((one[2] === "/reply" || one[2] === "/replyAll") && req.method === "POST") {
        seen.sent.push({ replyTo: m.id, all: one[2] === "/replyAll", comment: given?.comment });
        return res.writeHead(202).end();
      }
      if ((one[2] === "/createReply" || one[2] === "/createReplyAll") && req.method === "POST") {
        const d = { id: `d${++drafts}`, subject: `RE: ${m.subject}`, isDraft: true, toRecipients: [m.from], body: { content: given?.comment ?? "" } };
        messages.push(d);
        return json(res, 201, d);
      }
      return json(res, 400, { error: { message: `The stand-in doesn't do ${req.method} ${p}` } });
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return {
    url: base,
    seen,
    /** The access token stops working (as one does after an hour); `refresh` false: so does the refresh token. */
    expire(refresh = true) {
      access = crypto.randomBytes(12).toString("hex");
      refreshOk = refresh;
    },
    close: () => (server.closeAllConnections(), server.close()),
  };
}
