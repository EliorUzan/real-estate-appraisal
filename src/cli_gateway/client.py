import json
import urllib.request
import urllib.error
from urllib.parse import urlparse
from .contracts import GatewayError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, url, host_id, secret):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Worker endpoint must be a fixed HTTPS URL")
        self.url, self.host_id, self.secret = url, host_id, secret
        self.http = urllib.request.build_opener(NoRedirect())

    def call(self, action, **fields):
        body = json.dumps({"schemaVersion": 1, "action": action, **fields}, ensure_ascii=False).encode()
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + self.secret,
            "X-CLI-Host-ID": self.host_id})
        try:
            with self.http.open(req, timeout=10) as response:
                raw = response.read(1024 * 1024 + 1)
                if len(raw) > 1024 * 1024:
                    raise GatewayError("INVALID_OUTPUT")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            # Never include remote body, URL, request headers or prompts in diagnostics.
            raise GatewayError("CONTROL_" + str(exc.code)) from None
