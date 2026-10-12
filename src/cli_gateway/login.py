"""Serialized native login and bounded credential verification under the supervisor lock."""
import hashlib
import json
import os
import re
from pathlib import Path
import select
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from .contracts import GatewayError, MAX_STDOUT, MAX_STDERR, canonical_digest
from .network import controls, regular_bytes
from .runner import Buffer
from .adapters import parse_result, prompt_input
from .login_crypto import LoginKey
from .login_protocol import NativeProtocol, PROTOCOL
from .login_recovery import names


def load_login_manifests(directory, approved):
    entries = {}
    if not directory:
        return entries
    for path in Path(directory).glob("*.json"):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Regular reviewed login manifest required")
        raw = path.read_bytes()
        entry = json.loads(raw)
        job = approved.get(entry.get("inferenceManifestDigest"))
        if (not job or entry.get("protocol") != PROTOCOL or entry.get("version") != "1.3.3"
            or entry.get("nativeProtocolVerified") is not True or entry.get("customerReleaseApproved") is not False
            or entry.get("personalRuntimeRef") != job.get("personalRuntimeRef")
            or entry.get("image") != job.get("image") or entry.get("network") != "cli-login-gemini"):
            raise ValueError("Login evidence does not cover the approved personal runtime")
        rules = json.loads(regular_bytes(entry["protocolFile"], entry["protocolDigest"]))
        NativeProtocol(rules)
        regular_bytes(entry["egressFile"], entry["egressDigest"])
        regular_bytes(entry["verificationSettingsFile"], entry["verificationPolicyDigest"])
        regular_bytes(entry["verificationAgentFile"], entry["verificationAgentDigest"])
        evidence = json.loads(regular_bytes(entry["evidenceFile"], entry["evidenceDigest"]))
        checks = {"freshChallenge", "codeWaitFence", "cachedReuse", "credentialSavedBeforeStop", "invalidCode", "noSecretLogs", "loginEgress"}
        if (evidence.get("checks") != {name: True for name in checks}
            or any(evidence.get(k) != entry.get(k) for k in ("image", "version", "protocolDigest", "egressDigest", "personalRuntimeRef"))):
            raise ValueError("Incomplete native-login verification evidence")
        entries[hashlib.sha256(raw).hexdigest()] = entry
    return entries


class LoginRunner:
    def __init__(self, engine, client, journal, clock=time.monotonic, sleep=time.sleep):
        self.engine, self.client, self.journal, self.clock, self.sleep = engine, client, journal, clock, sleep
        self.ids = self.identity = None
        self.last_contact = 0

    def heartbeat(self):
        response = self.client.call("heartbeatLogin", **self.ids)
        self.last_contact = self.clock()
        if response.get("stop"):
            raise GatewayError(response.get("reason") or "CANCELLED")
        return response

    def create_login(self, login, manifest, inference):
        name = names(login["sessionId"])[0]
        if (login["runtimeRef"] != manifest["personalRuntimeRef"] or os.environ.get("CODESPACES") != "true"
            or manifest["image"] != inference["image"]):
            raise GatewayError("MANIFEST_MISMATCH")
        proxy = controls(self.engine, manifest)
        # Empty working/config directories exclude agent definitions, plugins and hooks.
        self.engine.command(["create", "--name", name, "--label", "appraisal.cli-gateway=1", "--label", "appraisal.cli-kind=login",
            "--interactive", "--tty", "--restart", "no", "--log-driver", "none", "--read-only", "--user", "1000:1000",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--ulimit", "core=0", "--cpus", "1", "--memory", "2g", "--pids-limit", "128",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--tmpfs", "/work:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
            "--mount", "type=volume,source=" + login["runtimeRef"] + ",target=/home/agent",
            "--mount", "type=bind,source=" + inference["settingsFile"] + ",target=/home/agent/.gemini/antigravity-cli/settings.json,readonly",
            "--tmpfs", "/home/agent/.gemini/config:rw,noexec,nosuid,size=16m,uid=1000,gid=1000",
            "--tmpfs", "/home/agent/.agents:ro,noexec,nosuid,size=1m,uid=1000,gid=1000",
            "--tmpfs", "/home/agent/.gemini/antigravity-cli/plugins:ro,noexec,nosuid,size=1m,uid=1000,gid=1000",
            "--tmpfs", "/home/agent/.gemini/skills:ro,noexec,nosuid,size=1m,uid=1000,gid=1000",
            "--tmpfs", "/home/agent/.gemini/extensions:ro,noexec,nosuid,size=1m,uid=1000,gid=1000",
            "--network", manifest["network"], "--workdir", "/work", "--env", "HOME=/home/agent", "--env", "LANG=C.UTF-8",
            "--env", "TERM=xterm-256color", "--env", "NO_BROWSER=true", "--env", "AGY_CLI_DISABLE_AUTO_UPDATE=true",
            *proxy, manifest["image"], "agy", "--log-file", "/dev/null"])
        return name

    def stop_container(self, name, process=None):
        if name in self.engine.inventory():
            state = self.engine.stop(name)
            if process:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            self.engine.remove(name)
            return state
        return {"Running": False}  # Successful inventory proves absence.

    def interactive(self, login, manifest, inference):
        import fcntl
        import pty
        import struct
        import termios
        import tty
        name = names(login["sessionId"])[0]
        self.identity.update(containerRef=name, phase="create_intent")
        self.journal.save(self.identity)
        self.create_login(login, manifest, inference)
        authorized = self.client.call("registerLoginContainer", **self.ids, containerRef=name, containerKind="login", previousStopped=False)
        if not authorized.get("authorized"):
            raise GatewayError("CANCELLED")
        self.identity["phase"] = "start_intent"
        self.journal.save(self.identity)
        master, slave = pty.openpty()
        tty.setraw(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 160, 0, 0))
        attributes = termios.tcgetattr(slave)
        attributes[3] &= ~termios.ECHO
        termios.tcsetattr(slave, termios.TCSANOW, attributes)
        process = None
        key, challenge = None, None
        protocol = NativeProtocol(json.loads(regular_bytes(manifest["protocolFile"], manifest["protocolDigest"])))
        started = self.clock()
        next_poll = started
        try:
            process = subprocess.Popen([self.engine.executable, "start", "--attach", "--interactive", name], stdin=slave, stdout=slave, stderr=slave, env=self.engine.env)
            os.close(slave)
            slave = None
            while self.clock() - started < 300:
                if self.clock() >= next_poll:
                    response = self.heartbeat()
                    next_poll = self.clock() + 2
                    envelope = response.get("envelope")
                    if envelope is not None:
                        if not key or not challenge or self.identity.get("phase") == "code_write_intent":
                            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
                        code = key.decrypt(envelope, login["sessionId"], login["connectionRevision"], challenge, response["submissionId"])
                        protocol.authorize_code()
                        consumed = self.client.call("consumeLoginCode", **self.ids, submissionId=response["submissionId"])
                        if not consumed.get("acknowledged") or consumed.get("alreadyConsumed"):
                            raise GatewayError("WORKER_LOST")
                        self.identity.update(phase="code_write_intent", submissionId=response["submissionId"])
                        self.journal.save(self.identity)
                        # Network acknowledgements can take seconds. Drain current output
                        # and recheck the actual screen immediately before secret input.
                        for _ in range(32):
                            if not select.select([master], [], [], 0)[0]:
                                break
                            current = protocol.feed(os.read(master, 8192))
                            if current and current["kind"] == "authenticated":
                                return  # Native auth advanced; never send code into its prompt.
                        if process.poll() is not None or protocol.screen.pending or not re.search(protocol.rules['codePrompt'], protocol.screen.text()):
                            raise GatewayError("LOGIN_PROTOCOL_CHANGED")
                        input_bytes = code.encode() + protocol.rules.get('codeTerminator', '\r').encode('ascii')
                        if os.write(master, input_bytes) != len(input_bytes):
                            raise GatewayError("WORKER_LOST")
                        code, key = None, None
                if select.select([master], [], [], 0.2)[0]:
                    try:
                        chunk = os.read(master, 8192)
                    except OSError:
                        raise GatewayError("CLI_FAILED") from None
                    event = protocol.feed(chunk)
                    for reply in protocol.terminal_replies():
                        os.write(master, reply)
                    if event and event["kind"] == "menu":
                        os.write(master, event["input"])
                    elif event and event["kind"] == "challenge" and challenge is None:
                        key, challenge = LoginKey(), str(uuid.uuid4())
                        expiry = (datetime.now(timezone.utc) + timedelta(seconds=max(1, 300 - (self.clock() - started)))).isoformat()
                        self.client.call("publishLoginChallenge", **self.ids, challengeId=challenge, keyId=key.key_id, authorizationUrl=event["url"], publicKeyJwk=key.public_jwk(), expiresAt=expiry)
                    elif event and event["kind"] == "authenticated":
                        return
                if process.poll() is not None:
                    raise GatewayError("CLI_FAILED")
                if challenge is None and self.clock() - started > 60:
                    raise GatewayError("LOGIN_PROTOCOL_CHANGED")
            raise GatewayError("LOGIN_EXPIRED")
        finally:
            self.stop_container(name, process)
            if slave is not None:
                os.close(slave)
            os.close(master)

    def verify(self, login, manifest, inference):
        verification = {**inference, "capabilityProfile": None, "settingsFile": manifest["verificationSettingsFile"], "policyDigest": manifest["verificationPolicyDigest"],
                        "agentFile": manifest["verificationAgentFile"], "agentDigest": manifest["verificationAgentDigest"]}
        name = names(login["sessionId"])[1]
        self.identity.update(containerRef=name, phase="verification_create_intent")
        self.journal.save(self.identity)
        self.client.call("beginLoginVerification", **self.ids)
        job = {"jobId": login["sessionId"], "attemptNumber": 1, "runtimeRef": login["runtimeRef"], "provider": "gemini"}
        self.engine.create(job, verification, verification=True)
        response = self.client.call("registerLoginContainer", **self.ids, containerRef=name, containerKind="login_verification", previousStopped=True)
        if not response.get("authorized"):
            raise GatewayError("CANCELLED")
        self.identity["phase"] = "verification_start_intent"
        self.journal.save(self.identity)
        process = self.engine.start(name)
        stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
        threads = [threading.Thread(target=b.read, args=(pipe,), daemon=True) for b, pipe in ((stdout, process.stdout), (stderr, process.stderr))]
        for thread in threads:
            thread.start()
        def send():
            try:
                process.stdin.write(prompt_input("gemini", "Return only the word CONNECTED. Do not use tools.", "Account availability test."))
                process.stdin.close()
            except (OSError, BrokenPipeError):
                pass
        threading.Thread(target=send, daemon=True).start()
        started, next_poll = self.clock(), self.clock()
        try:
            while process.poll() is None:
                if self.clock() - started > 90 or stdout.exceeded or stderr.exceeded:
                    raise GatewayError("CLI_FAILED")
                if self.clock() >= next_poll:
                    self.heartbeat()
                    next_poll = self.clock() + 10
                self.sleep(0.1)
            state = self.engine.stop(name)
            for thread in threads:
                thread.join(timeout=5)
            result = parse_result("gemini", bytes(stdout.data), bytes(stderr.data), state.get("ExitCode", 1))
            if result.error:
                raise GatewayError(result.error)
            return canonical_digest(result.payload())
        finally:
            self.stop_container(name, process)

    def run(self, login, manifest, inference):
        self.ids = {key: login[key] for key in ("sessionId", "leaseToken")}
        self.identity = {**self.ids, "phase": "claimed"}
        self.journal.save(self.identity)
        outcome, error, digest = "failed", None, None
        try:
            self.heartbeat()
            if login["kind"] == "interactive_login":
                self.interactive(login, manifest, inference)
            digest = self.verify(login, manifest, inference)
            outcome = "succeeded"
        except GatewayError as exc:
            error = exc.code if exc.code in {"AUTH_REQUIRED", "LOGIN_PROTOCOL_CHANGED", "LOGIN_EXPIRED", "WORKER_LOST", "CANCELLED", "INVALID_CODE", "MANIFEST_MISMATCH"} else "CLI_FAILED"
            if exc.code in {"PLAN_REQUIRED", "QUOTA_EXCEEDED"}:
                outcome, error = ("plan_blocked" if exc.code == "PLAN_REQUIRED" else "quota_blocked"), None
        finally:
            # This also cleans up containers created before an attach/start failure.
            for name in names(login["sessionId"]):
                self.stop_container(name)
        digest = canonical_digest({"sessionId": login["sessionId"], "outcome": outcome, "errorCode": error, "resultDigest": digest})
        receipt = self.client.call("completeLogin", **self.ids, stopped=True, outcome=outcome, errorCode=error, receiptDigest=digest)
        if not receipt.get("acknowledged"):
            raise GatewayError("WORKER_LOST")
        self.journal.clear()
        return receipt
