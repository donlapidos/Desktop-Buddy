// A stand-in for a service's MCP server, on this PC, for tests (test/connectors.test.js, the e2e "connections"
// check): OAuth 2.1 the way Notion's and Linear's servers do it (metadata, dynamic client registration, PKCE S256, an
// authorize page that says yes at once), and two tools behind a bearer token. Nothing here is used by Buddy itself.
import crypto from "node:crypto";
import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOOLS = [
  { name: "search_docs", description: "Search the user's documents.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { title: "Search documents", readOnlyHint: true } },
  { name: "add_note", description: "Add a note to a document.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { title: "Add a note" } },
];

/** Starts the service. Resolves its MCP address, what it has seen, and close(). */
export async function startTestService() {
  const seen = { registered: 0, tokens: 0, calls: /** @type {any[]} */ ([]), refusedTokens: 0 };
  /** @type {Map<string, { challenge: string, redirect: string }>} */
  const codes = new Map();
  const token = crypto.randomBytes(12).toString("hex");
  let base = "";

  const mcp = () => {
    const server = new Server({ name: "test-docs", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      seen.calls.push({ name: req.params.name, args: req.params.arguments });
      if (req.params.name === "search_docs") return { content: [{ type: "text", text: `Budget 2027: the Q3 numbers are in the Forecast sheet. (searched for ${JSON.stringify(req.params.arguments?.query)})` }] };
      return { content: [{ type: "text", text: "Note added." }] };
    });
    return server;
  };

  const body = async (req) => {
    let s = "";
    for await (const c of req) s += c;
    return s;
  };
  const json = (res, code, value, headers = {}) => res.writeHead(code, { "content-type": "application/json", ...headers }).end(JSON.stringify(value));

  const httpServer = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", base);
    if (u.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (u.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    }
    if (u.pathname === "/register" && req.method === "POST") {
      seen.registered++;
      return json(res, 201, { ...JSON.parse(await body(req)), client_id: `client-${seen.registered}` });
    }
    if (u.pathname === "/authorize") {
      // Says yes at once, as a person signing in would, and sends the browser back with a code.
      const code = crypto.randomBytes(8).toString("hex");
      codes.set(code, { challenge: u.searchParams.get("code_challenge") ?? "", redirect: u.searchParams.get("redirect_uri") ?? "" });
      const back = new URL(u.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", u.searchParams.get("state") ?? "");
      return res.writeHead(302, { location: back.toString() }).end();
    }
    if (u.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await body(req));
      if (form.get("grant_type") === "refresh_token") return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 3600, refresh_token: "refresh" });
      const issued = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!issued || issued.challenge !== challenge) return json(res, 400, { error: "invalid_grant" });
      codes.delete(form.get("code") ?? "");
      seen.tokens++;
      return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 3600, refresh_token: "refresh" });
    }
    if (u.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer ${token}`) {
        if (req.headers.authorization) seen.refusedTokens++;
        return res.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => transport.close());
      await mcp().connect(transport);
      const raw = req.method === "POST" ? await body(req) : "";
      return transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve(null)));
  base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (httpServer.address()).port}`;
  return { url: `${base}/mcp`, seen, close: () => (httpServer.closeAllConnections(), httpServer.close()) };
}
