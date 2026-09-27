import { Problem } from "./providers.ts";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const unavailable = () => new Problem(502, "לא ניתן להשלים את החיפוש ב־Nadlan MCP. בדקו את חיבור השרת ונסו שוב. לא הוחזרו עסקאות חלופיות.");

/** A request-scoped Streamable HTTP MCP session; no browser-supplied endpoints. */
export class NadlanMcp {
  private session = "";
  private version = "2025-03-26";
  private id = 0;
  private endpoint: string;
  private token: string;
  private fetcher: typeof fetch;

  constructor(endpoint: string, token = "", fetcher = fetch) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Problem(503, "שירות העסקאות עדיין אינו מחובר. יש להגדיר NADLAN_MCP_URL בשרת."); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Problem(503, "כתובת שרת Nadlan MCP חייבת להיות HTTPS תקינה.");
    }
    this.endpoint = url.href;
    this.token = token;
    this.fetcher = fetcher;
  }

  private headers() {
    return { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      "MCP-Protocol-Version": this.version };
  }

  private async rpc(method: string, params: ObjectValue, notification = false): Promise<ObjectValue> {
    const id = notification ? undefined : ++this.id;
    try {
      const response = await this.fetcher(this.endpoint, { method: "POST", headers: this.headers(), redirect: "error",
        body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw unavailable();
      if (method === "initialize") this.session = response.headers.get("Mcp-Session-Id") ?? "";
      if (notification) { await response.body?.cancel(); return {}; }
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const decoder = new TextDecoder();
      let buffer = "", size = 0;
      const sse = response.headers.get("content-type")?.includes("text/event-stream");
      const unwrap = (raw: unknown) => {
        const msg = object(raw);
        if (msg.id !== id) return null;
        if (msg.error || !msg.result) throw unavailable();
        return object(msg.result);
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (value) { size += value.length; buffer += decoder.decode(value, { stream: true }); }
          if (size > 2_000_000) throw unavailable();
          if (sse) {
            // Parse complete SSE events, including CRLF and multi-line data fields.
            let match: RegExpExecArray | null;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
              const event = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = event.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).replace(/^ /, "")).join("\n");
              if (data) { const result = unwrap(JSON.parse(data)); if (result) return result; }
            }
          }
          if (done) break;
        }
        if (!sse) { const result = unwrap(JSON.parse(buffer + decoder.decode())); if (result) return result; }
        throw unavailable();
      } finally { await reader.cancel().catch(() => {}); }
    } catch { throw unavailable(); }
  }

  async connect() {
    const init = await this.rpc("initialize", { protocolVersion: this.version, capabilities: {}, clientInfo: { name: "appraisal-assistant", version: "1.0.0" } });
    if (!["2025-03-26", "2025-06-18", "2025-11-25"].includes(String(init.protocolVersion))) throw unavailable();
    this.version = String(init.protocolVersion);
    await this.rpc("notifications/initialized", {}, true);
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const listed = await this.rpc("tools/list", cursor ? { cursor } : {});
      if (Array.isArray(listed.tools) && listed.tools.some(t => object(t).name === "find_recent_deals_for_address")) return;
      if (typeof listed.nextCursor !== "string") break;
      cursor = listed.nextCursor;
    }
    throw new Problem(502, "שרת Nadlan MCP אינו מציע את כלי אחזור העסקאות הנדרש.");
  }

  async deals(args: ObjectValue): Promise<unknown[]> {
    const result = await this.rpc("tools/call", { name: "find_recent_deals_for_address", arguments: args });
    const sourceMessages = [object(result.structuredContent).result,
      ...(Array.isArray(result.content) ? result.content.map(object).filter(p => p.type === "text").map(p => p.text) : [])];
    if (sourceMessages.some(value => typeof value === "string" && /^Error\b/.test(value)
      && /403 Client Error: Forbidden for url: https:\/\/www\.govmap\.gov\.il\//.test(value))) {
      // Report a known upstream refusal without exposing arbitrary tool error content.
      throw new Problem(502, "החיבור ל־Nadlan MCP פעיל, אך GovMap דחה את הגישה למקור הנתונים (403). מנהל המערכת צריך להסדיר גישה למקור לפני שניתן למשוך עסקאות.");
    }
    if (result.isError) throw unavailable();
    let payload: unknown = result.structuredContent;
    if (!payload && Array.isArray(result.content)) {
      const parts = result.content.map(object).filter(p => p.type === "text").map(p => String(p.text ?? ""));
      const text = parts.join("\n").trim();
      // Upstream returns plain text for a legitimate empty result, and also for errors.
      if (/^No (?:first hand \(new\) |second hand \(used\) )?deals found\b/.test(text)) return [];
      try { payload = JSON.parse(text); } catch { throw unavailable(); }
    }
    // FastMCP versions may wrap a tool's JSON-string return value in { result }.
    if (typeof object(payload).result === "string") {
      const text = object(payload).result as string;
      if (/^No (?:first hand \(new\) |second hand \(used\) )?deals found\b/.test(text)) return [];
      try { payload = JSON.parse(text); } catch { throw unavailable(); }
    }
    const deals = Array.isArray(payload) ? payload : object(payload).deals;
    if (!Array.isArray(deals) || deals.length > 200) throw unavailable();
    return deals;
  }

  async close() {
    if (this.session) await this.fetcher(this.endpoint, { method: "DELETE", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(3000) }).then(r => r.body?.cancel()).catch(() => {});
  }
}
