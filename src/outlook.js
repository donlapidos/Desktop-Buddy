// Outlook, as a connection (connectors.js): the user's mail through Microsoft Graph, with Buddy's own small set of
// tools. Microsoft's sign-in has no way for an app to register itself, so Buddy is registered with Microsoft once (an
// app registration, public client, no secret) and signs in with that client id: authorization code with PKCE, back
// to http://localhost on this PC. Work and personal (outlook.com) accounts both work.
//
// Mail is information from other people, so what it says never steers Buddy (connectors.js resultText marks it).
// Sending is how a message could leave with something it shouldn't, so every send asks on Buddy's card, naming who
// it goes to, and "Allow for this task" never covers it (connectors.js describe: once).
import { N } from "./i18n.js";

// Buddy's app registration with Microsoft (Entra ID › App registrations): any organisation's accounts and personal
// accounts, a public client whose redirect is http://localhost/callback. Empty until it's registered, and Outlook
// isn't offered until then.
export const OUTLOOK_CLIENT_ID = "";

const LOGIN = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
// offline_access: a refresh token, so the user signs in once. User.Read: whose mailbox it is.
const SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];

// Outlook on the web (its old and new addresses) and the Outlook apps, whose window titles end "- Outlook".
const SITES = /(^|[^a-z0-9.-])outlook\.(office|office365|live)\.com\b|(^|[^a-z0-9.-])outlook\.cloud\.microsoft\b|\s-\sOutlook(\s-\s|\s*$)/im;

export const MAX_RECIPIENTS = 20; // one message, not a mailing
const MAX_LIST = 25;
const MAX_BODY = 20_000;
const FOLDERS = ["inbox", "sentitems", "drafts", "archive", "deleteditems", "junkemail"];

const isAddress = (/** @type {string} */ s) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s);

/**
 * The addresses a tool was given, checked: a list of plain email addresses, at most MAX_RECIPIENTS in all.
 * Resolves the list, or a sentence for the model saying what's wrong.
 * @param {any} to @param {any} cc
 * @returns {{ to: string[], cc: string[] } | string}
 */
export function recipients(to, cc) {
  const list = (/** @type {any} */ v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);
  const t = list(to);
  const c = list(cc);
  const bad = [...t, ...c].filter((a) => !isAddress(a));
  if (bad.length) return `Not an email address: ${bad.slice(0, 3).join(", ")}. Give plain addresses (name@example.com); ask the user if you don't know one.`;
  if (t.length + c.length > MAX_RECIPIENTS) return `That's more than ${MAX_RECIPIENTS} people: Buddy sends one message at a time, not a mailing.`;
  return { to: t, cc: c };
}

const asRecipients = (/** @type {string[]} */ list) => list.map((address) => ({ emailAddress: { address } }));
const who = (/** @type {any} */ r) => {
  const e = r?.emailAddress ?? {};
  return e.name && e.address && e.name !== e.address ? `${e.name} <${e.address}>` : e.address || e.name || "(unknown)";
};
const when = (/** @type {string} */ iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
};
const clip = (/** @type {string} */ s, /** @type {number} */ n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Where search_mail looks, as a Graph path and query. A search can't be sorted or filtered with it in Graph, so
 * "unread only" is applied to the results instead.
 * @param {any} input @returns {{ path: string, filterUnread: boolean }}
 */
export function searchPath(input) {
  const i = input ?? {};
  const folder = FOLDERS.includes(i.folder) ? i.folder : null;
  const count = Math.min(Math.max(Number.parseInt(i.count, 10) || 10, 1), MAX_LIST);
  /** @type {[string, string][]} */
  const q = [["$top", String(count)], ["$select", "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments"]];
  const words = String(i.query ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (words) q.push(["$search", `"${words}"`]);
  else {
    q.push(["$orderby", "receivedDateTime desc"]);
    if (i.unread_only) q.push(["$filter", "isRead eq false"]);
  }
  // Spaces as %20 (OData's way), not URLSearchParams' "+".
  const query = q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return { path: `${folder ? `/me/mailFolders/${folder}` : "/me"}/messages?${query}`, filterUnread: !!(words && i.unread_only) };
}

/** A list of messages, as the model reads it. @param {any[]} messages */
export function listText(messages) {
  if (!messages.length) return "No messages found.";
  return messages.map((m, n) => {
    const flags = [when(m.receivedDateTime), m.isRead === false ? "unread" : "", m.hasAttachments ? "has attachments" : ""].filter(Boolean).join(" · ");
    return `${n + 1}. From ${who(m.from)} · ${flags}\n   Subject: ${m.subject || "(no subject)"}\n   ${clip(String(m.bodyPreview ?? "").replace(/\s+/g, " "), 200)}\n   id: ${m.id}`;
  }).join("\n");
}

/** One message in full, as the model reads it. @param {any} m */
export function messageText(m) {
  const head = [
    `From: ${who(m.from)}`,
    `To: ${(m.toRecipients ?? []).map(who).join(", ") || "(none)"}`,
    m.ccRecipients?.length ? `Cc: ${m.ccRecipients.map(who).join(", ")}` : "",
    `Received: ${when(m.receivedDateTime)}`,
    `Subject: ${m.subject || "(no subject)"}`,
    m.hasAttachments ? "It has attachments (Buddy can't open them here)." : "",
  ].filter(Boolean);
  return `${head.join("\n")}\n\n${clip(String(m.body?.content ?? "").trim(), MAX_BODY)}`;
}

/** A new message's Graph shape. @param {{ to: string[], cc: string[] }} r @param {any} input */
const newMessage = (r, input) => ({
  subject: String(input.subject ?? ""),
  body: { contentType: "Text", content: String(input.body ?? "") },
  toRecipients: asRecipients(r.to),
  ...(r.cc.length ? { ccRecipients: asRecipients(r.cc) } : {}),
});

const messageId = (/** @type {any} */ id) => encodeURIComponent(String(id ?? "").trim());

/**
 * The tools Buddy offers for Outlook. `run(graph, input)` does one; `graph(method, path, body?)` is a signed-in call
 * to Microsoft Graph that resolves its JSON (or null for an empty answer). `note(graph, input)` is what the approval
 * card says under the action, in plain words. `once`: the card asks every time ("Allow for this task" doesn't
 * cover it).
 * @typedef {(method: string, path: string, body?: any, headers?: Record<string, string>) => Promise<any>} Graph
 * @typedef {{ name: string, title: string, description: string, readOnly?: boolean, once?: boolean, input_schema: any,
 *   run: (graph: Graph, input: any) => Promise<string>, note?: (graph: Graph, input: any) => Promise<string> }} NativeTool
 */

const addressList = { type: "array", items: { type: "string" }, description: "Email addresses, like name@example.com." };

/** What the card says for a message about to go out, or be saved as a draft. */
async function messageNote(/** @type {Graph} */ graph, /** @type {any} */ input, /** @type {boolean} */ draft) {
  const body = clip(String(input.body ?? "").replace(/\s+/g, " ").trim(), 200);
  if (input.reply_to_id) {
    const m = await graph("GET", `/me/messages/${messageId(input.reply_to_id)}?$select=subject,from,toRecipients,ccRecipients`).catch(() => null);
    const all = input.reply_all ? [m?.from, ...(m?.toRecipients ?? []), ...(m?.ccRecipients ?? [])] : [m?.from];
    const to = all.filter(Boolean).map(who).join(", ") || "the sender";
    return `${draft ? "A draft reply (not sent)" : "Reply"} to ${to} · Re: ${m?.subject || "(no subject)"}${body ? ` · “${body}”` : ""}`;
  }
  const r = recipients(input.to, input.cc);
  const to = typeof r === "string" ? String(input.to ?? "") : [...r.to, ...r.cc].join(", ");
  return `${draft ? "A draft (not sent) to" : "To"} ${to || "(nobody)"} · Subject: ${String(input.subject ?? "") || "(no subject)"}${body ? ` · “${body}”` : ""}`;
}

/** @type {NativeTool[]} */
export const OUTLOOK_TOOLS = [
  {
    name: "search_mail",
    title: N("Look through your email"),
    readOnly: true,
    description: "Lists the user's email, newest first, or the messages matching a search (words, a sender, a subject). Each comes with an id for read_mail.",
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "Words to search for, e.g. a sender's name or a subject. Leave out to list the newest." },
      folder: { type: "string", enum: FOLDERS, description: "Only this folder. Leave out for all mail." },
      unread_only: { type: "boolean" },
      count: { type: "integer", minimum: 1, maximum: MAX_LIST, description: "How many (default 10)." },
    } },
    async run(graph, input) {
      const { path, filterUnread } = searchPath(input);
      const res = await graph("GET", path);
      const list = (res?.value ?? []).filter((m) => !filterUnread || m.isRead === false);
      return listText(list);
    },
  },
  {
    name: "read_mail",
    title: N("Read an email"),
    readOnly: true,
    description: "Reads one email in full, by the id search_mail gave.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async run(graph, input) {
      const m = await graph("GET", `/me/messages/${messageId(input?.id)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments`, undefined, { Prefer: 'outlook.body-content-type="text"' });
      return messageText(m);
    },
  },
  {
    name: "draft_mail",
    title: N("Save an email as a draft"),
    description: "Saves an email in the user's Drafts folder without sending it, so they can look it over in Outlook. To reply, give reply_to_id (and reply_all to answer everyone) instead of to.",
    input_schema: { type: "object", properties: {
      to: addressList, cc: addressList, subject: { type: "string" }, body: { type: "string", description: "Plain text." },
      reply_to_id: { type: "string", description: "The id of the email this answers." }, reply_all: { type: "boolean" },
    }, required: ["body"] },
    note: (graph, input) => messageNote(graph, input, true),
    async run(graph, input) {
      if (input?.reply_to_id) {
        const d = await graph("POST", `/me/messages/${messageId(input.reply_to_id)}/${input.reply_all ? "createReplyAll" : "createReply"}`, { comment: String(input.body ?? "") });
        return `Saved a reply in Drafts, not sent: "${d?.subject ?? ""}". Draft id: ${d?.id}`;
      }
      const r = recipients(input?.to, input?.cc);
      if (typeof r === "string") return r;
      const d = await graph("POST", "/me/messages", newMessage(r, input));
      return `Saved in Drafts, not sent: "${d?.subject ?? ""}" to ${r.to.join(", ") || "(nobody yet)"}. Draft id: ${d?.id}`;
    },
  },
  {
    name: "send_mail",
    title: N("Send an email"),
    once: true,
    description: "Sends an email from the user's account. To reply, give reply_to_id (and reply_all to answer everyone) instead of to. Only send what the user asked for; if they haven't said who it goes to or what it says, ask them first.",
    input_schema: { type: "object", properties: {
      to: addressList, cc: addressList, subject: { type: "string" }, body: { type: "string", description: "Plain text." },
      reply_to_id: { type: "string", description: "The id of the email this answers." }, reply_all: { type: "boolean" },
    }, required: ["body"] },
    note: (graph, input) => messageNote(graph, input, false),
    async run(graph, input) {
      if (input?.reply_to_id) {
        await graph("POST", `/me/messages/${messageId(input.reply_to_id)}/${input.reply_all ? "replyAll" : "reply"}`, { comment: String(input.body ?? "") });
        return "Sent the reply.";
      }
      const r = recipients(input?.to, input?.cc);
      if (typeof r === "string") return r;
      if (!r.to.length) return "Nobody to send it to: give at least one address in to.";
      await graph("POST", "/me/sendMail", { message: newMessage(r, input), saveToSentItems: true });
      return `Sent to ${[...r.to, ...r.cc].join(", ")}.`;
    },
  },
  {
    name: "send_draft",
    title: N("Send a draft"),
    once: true,
    description: "Sends a draft saved earlier (draft_mail), by its draft id.",
    input_schema: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
    async note(graph, input) {
      const m = await graph("GET", `/me/messages/${messageId(input?.draft_id)}?$select=subject,toRecipients,ccRecipients,body`, undefined, { Prefer: 'outlook.body-content-type="text"' }).catch(() => null);
      if (!m) return "A draft Buddy couldn't open";
      const to = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(who).join(", ") || "(nobody)";
      const body = clip(String(m.body?.content ?? "").replace(/\s+/g, " ").trim(), 200);
      return `To ${to} · Subject: ${m.subject || "(no subject)"}${body ? ` · “${body}”` : ""}`;
    },
    async run(graph, input) {
      const id = messageId(input?.draft_id);
      const m = await graph("GET", `/me/messages/${id}?$select=isDraft,toRecipients,ccRecipients,bccRecipients`);
      if (!m?.isDraft) return "That isn't a draft, so it wasn't sent.";
      const all = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? []), ...(m.bccRecipients ?? [])];
      if (!all.length) return "The draft has nobody to send it to.";
      if (all.length > MAX_RECIPIENTS) return `The draft goes to more than ${MAX_RECIPIENTS} people: Buddy sends one message at a time, not a mailing.`;
      await graph("POST", `/me/messages/${id}/send`);
      return "Sent the draft.";
    },
  },
];

/**
 * Outlook as a connection, or null while Buddy has no client id. End-to-end checks point it at a stand-in
 * Microsoft on this PC (BUDDY_OUTLOOK_TEST: its address), and only then.
 * @returns {import("./connectors.js").Connector | null}
 */
export function outlookConnector(env = process.env) {
  const test = env.BUDDY_E2E && env.BUDDY_OUTLOOK_TEST;
  const clientId = test ? "test-client" : OUTLOOK_CLIENT_ID;
  if (!clientId) return null;
  return {
    id: "outlook",
    label: "Outlook",
    url: test ? `${test}/graph` : GRAPH,
    sites: SITES,
    does: N("read your email, and write and send it"),
    native: {
      clientId,
      authorize: test ? `${test}/authorize` : `${LOGIN}/authorize`,
      token: test ? `${test}/token` : `${LOGIN}/token`,
      scopes: SCOPES,
      tools: OUTLOOK_TOOLS,
    },
  };
}
