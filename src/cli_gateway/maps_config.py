"""Private, staged Maps Demo config. Provisioning never enables agent MCP tools."""
import json
import os
from pathlib import Path
import re
import uuid
import urllib.request
import urllib.error
from .client import NoRedirect
from .contracts import GatewayError, canonical_digest

MAPS_URL = "https://mapstools.googleapis.com/mcp"


def demo_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"AIza[A-Za-z0-9_-]{35}", value):
        raise GatewayError("MAPS_INVALID_KEY")
    return value


def mcp_json(raw):
    if len(raw) > 65536:
        raise GatewayError("MAPS_PROTOCOL_CHANGED")
    try:
        text = raw.decode("utf-8", "strict")
        if text.lstrip().startswith("{"):
            return json.loads(text)
        # Streamable HTTP may return an SSE data event rather than application/json.
        values = [json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith("data:")]
        if len(values) != 1:
            raise ValueError()
        return values[0]
    except (ValueError, UnicodeError):
        raise GatewayError("MAPS_PROTOCOL_CHANGED") from None


def verify_key(value, opener=None, heartbeat=None):
    key = demo_key(value)
    http = opener or urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
    session = None
    protocol = "2025-06-18"
    def request(body):
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "X-Goog-Api-Key": key}
        if session:
            headers["Mcp-Session-Id"] = session
            headers["MCP-Protocol-Version"] = protocol
        req = urllib.request.Request(MAPS_URL, data=json.dumps(body, separators=(",", ":")).encode(), headers=headers, method="POST")
        try:
            with http.open(req, timeout=10) as response:
                raw = response.read(65537)
                if heartbeat:
                    heartbeat()
                return mcp_json(raw) if raw.strip() else None, response.headers.get("Mcp-Session-Id")
        except urllib.error.HTTPError as exc:
            code = "MAPS_INVALID_KEY" if exc.code in (401, 403) else "MAPS_QUOTA_EXCEEDED" if exc.code == 429 else "MAPS_SETUP_FAILED"
            raise GatewayError(code) from None
        except (OSError, ValueError):
            raise GatewayError("MAPS_SETUP_FAILED") from None
    initialized, session = request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": protocol, "capabilities": {}, "clientInfo": {"name": "appraisal-maps-demo-check", "version": "1"}}})
    if not isinstance(initialized, dict) or not isinstance(initialized.get("result"), dict):
        raise GatewayError("MAPS_PROTOCOL_CHANGED")
    protocol = initialized["result"].get("protocolVersion")
    if protocol not in {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"} or session and (len(session) > 4096 or not re.fullmatch(r"[!-~]+", session)):
        raise GatewayError("MAPS_PROTOCOL_CHANGED")
    request({"jsonrpc": "2.0", "method": "notifications/initialized"})
    response, _ = request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = response.get("result", {}).get("tools") if isinstance(response, dict) else None
    if not isinstance(tools, list) or not 1 <= len(tools) <= 20:
        raise GatewayError("MAPS_PROTOCOL_CHANGED")
    names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
    if len(names) != len(tools) or not all(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name) for name in names):
        raise GatewayError("MAPS_PROTOCOL_CHANGED")
    # Metadata only; no public place data or API key becomes model input here.
    return {"toolNames": sorted(names), "catalogAccessible": True}


class MapsStore:
    def __init__(self, directory):
        path = Path(directory)
        if not path.is_absolute() or path.is_symlink():
            raise ValueError("Private absolute Maps configuration directory required")
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.resolve() != path or path.stat().st_mode & 0o077:
            raise ValueError("Private regular Maps configuration directory required")
        self.directory = path

    def path(self, session_id):
        value = str(uuid.UUID(session_id))
        if value != session_id:
            raise ValueError("Invalid Maps setup identity")
        return self.directory / ("maps-candidate-" + value + ".json")

    def save(self, session_id, version, value, metadata):
        target = self.path(session_id)
        if target.exists() or target.is_symlink():
            raise GatewayError("MAPS_SETUP_FAILED")
        pending = {"version": version, "purpose": "maps-demo", "activation": "compatibility_pending", "metadata": metadata,
            "mcpServers": {"google-maps": {"serverUrl": MAPS_URL, "headers": {"X-Goog-Api-Key": demo_key(value)}}}}
        temporary = self.directory / (target.name + ".tmp")
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(pending, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        if os.name != "nt":
            directory_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)

    def remove(self, session_id=None):
        targets = [self.path(session_id)] if session_id else list(self.directory.glob("maps-candidate-*.json"))
        for target in targets:
            if target.is_symlink() or target.exists() and (not target.is_file() or target.stat().st_mode & 0o077):
                raise GatewayError("MAPS_SETUP_FAILED")
            target.unlink(missing_ok=True)


class MapsSetupRunner:
    def __init__(self, engine, client, journal, store, checker=verify_key, sleep=None, clock=None):
        import time
        self.engine, self.client, self.journal, self.store, self.checker = engine, client, journal, store, checker
        self.sleep, self.clock = sleep or time.sleep, clock or time.monotonic

    def run(self, setup):
        from .login_crypto import LoginKey
        ids = {k: setup[k] for k in ("sessionId", "leaseToken")}
        identity = {**ids, "phase": "claimed"}
        self.journal.save(identity)
        key, challenge, value = None, None, None
        outcome, error = "failed", None
        try:
            if self.engine.inventory():
                raise GatewayError("MAPS_SETUP_FAILED")
            if setup["kind"] == "remove-maps":
                self.store.remove()
                outcome = "removed"
            else:
                key, challenge = LoginKey(), str(uuid.uuid4())
                self.client.call("publishSetupChallenge", **ids, challengeId=challenge, keyId=key.key_id, publicKeyJwk=key.public_jwk())
                started = self.clock()
                while self.clock() - started < 180:
                    response = self.client.call("heartbeatSetup", **ids)
                    if response.get("envelope"):
                        value = demo_key(key.decrypt(response["envelope"], setup["sessionId"], setup["version"], challenge, response["submissionId"], purpose="maps-demo"))
                        consumed = self.client.call("consumeSetupSecret", **ids, submissionId=response["submissionId"])
                        if not consumed.get("acknowledged") or consumed.get("alreadyConsumed"):
                            raise GatewayError("WORKER_LOST")
                        identity["phase"] = "verify_write_intent"
                        self.journal.save(identity)
                        metadata = self.checker(value, heartbeat=lambda: self.client.call("heartbeatSetup", **ids))
                        # Revalidate cancellation/lease after network calls, before persisting.
                        self.client.call("heartbeatSetup", **ids)
                        self.store.save(setup["sessionId"], setup["version"], value, metadata)
                        outcome = "saved"
                        break
                    self.sleep(2)
                else:
                    raise GatewayError("SETUP_EXPIRED")
        except GatewayError as exc:
            error = exc.code if exc.code in {"MAPS_INVALID_KEY", "MAPS_QUOTA_EXCEEDED", "MAPS_PROTOCOL_CHANGED", "SETUP_EXPIRED", "WORKER_LOST", "CANCELLED"} else "MAPS_SETUP_FAILED"
        finally:
            key, value = None, None
        if self.engine.inventory():
            raise GatewayError("STOP_UNCONFIRMED")
        receipt = self.client.call("completeSetup", **ids, exclusive=True, outcome=outcome, errorCode=error, receiptDigest=canonical_digest({"sessionId": setup["sessionId"], "version": setup["version"], "outcome": outcome, "errorCode": error}))
        if not receipt.get("acknowledged"):
            raise GatewayError("WORKER_LOST")
        if receipt.get("state") != "succeeded":
            self.store.remove(setup["sessionId"])
        self.journal.clear()


def recover_setup(engine, client, journal, store):
    local = journal.load()
    assigned = client.call("getSetupAssignment").get("setup")
    if not local and not assigned:
        return
    if local and assigned and local["sessionId"] != assigned["sessionId"] or engine.inventory():
        client.call("quarantineHost")
        raise GatewayError("STOP_UNCONFIRMED")
    attempt = local or assigned
    result = client.call("reconcileSetup", sessionId=attempt["sessionId"], exclusive=True)
    if not result.get("acknowledged"):
        raise GatewayError("WORKER_LOST")
    # No replay of key delivery/upstream calls. Remove uncommitted candidate only.
    if result.get("state") != "succeeded":
        store.remove(attempt["sessionId"])
    journal.clear()
