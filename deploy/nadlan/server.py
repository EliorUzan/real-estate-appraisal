"""Authenticated HTTP hosting wrapper around the upstream Nadlan MCP server."""
import hmac
import logging
import os


class AuthenticatedMcp:
    def __init__(self, app, token):
        if len(token) < 32:
            raise ValueError("NADLAN_MCP_TOKEN must contain at least 32 characters")
        self.app = app
        self.expected = ("Bearer " + token).encode("utf-8")

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            if scope["path"] == "/health" and scope["method"] == "GET":
                status, body = 200, b'{"status":"ok","service":"nadlan-mcp"}'
            elif not hmac.compare_digest(dict(scope["headers"]).get(b"authorization", b""), self.expected):
                status, body = 401, b'{"error":"Unauthorized"}'
            else:
                return await self.app(scope, receive, send)
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


def create_app():
    from mcp.server.transport_security import TransportSecuritySettings
    from nadlan_mcp.fastmcp_server import mcp

    hostname = (os.getenv("NADLAN_PUBLIC_HOST") or os.environ["RENDER_EXTERNAL_HOSTNAME"]).strip()
    if not hostname or "/" in hostname or ":" in hostname:
        raise ValueError("NADLAN_PUBLIC_HOST must be the hosting domain without https:// or a path")
    # Stateless requests support replicas; keep DNS-rebinding protection enabled.
    mcp.settings.stateless_http = True
    mcp.settings.json_response = True
    mcp.settings.transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[hostname, "127.0.0.1:*", "localhost:*"],
        allowed_origins=["https://" + hostname],
    )
    return AuthenticatedMcp(mcp.streamable_http_app(), os.environ["NADLAN_MCP_TOKEN"])


def main():
    import uvicorn
    app = create_app()
    # Upstream INFO logging contains searched addresses. Keep it out of hosting logs.
    logging.disable(logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")), access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
