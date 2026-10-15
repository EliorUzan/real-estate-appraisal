import json
import os
from pathlib import Path
import hashlib
import re
import subprocess
import threading
import time
from .adapters import invocation, parse_result, prompt_input
from .adapters.base import stream_diagnostics
from .contracts import GatewayError, Result, MAX_STDOUT, MAX_STDERR, HEARTBEAT_SECONDS, LEASE_MARGIN_SECONDS, runtime_seconds
from .network import controls as network_controls
from .research import PROFILE as RESEARCH_PROFILE, POLICY as RESEARCH_POLICY, AGENT as RESEARCH_AGENT, AGENT_NAME as RESEARCH_AGENT_NAME
from .claude import PROFILE as CLAUDE_PROFILE, POLICY as CLAUDE_POLICY

GOOGLE_AGENT = b'''---
name: cli-gateway-text
description: Answer text-only gateway requests using only the supplied prompt.
tools: []
excludeDefaultComponents: true
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
Use only the text supplied in the request. Produce the requested answer without accessing files, running commands, browsing, invoking MCP, or delegating to other agents.
'''


def container_name(job_id, attempt):
    import uuid
    parsed = str(uuid.UUID(job_id))
    if parsed != job_id or attempt != 1:
        raise ValueError("Invalid attempt identity")
    return "cli-job-" + parsed + "-1"


class Docker:
    def __init__(self, executable="/usr/bin/docker"):
        if not os.path.isabs(executable):
            raise ValueError("Use a fixed absolute Docker executable")
        self.executable = executable
        # Engine configuration is operator-controlled; never forwarded to job containers.
        self.env = {k: os.environ[k] for k in ("PATH", "HOME", "XDG_RUNTIME_DIR", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH") if k in os.environ}

    def command(self, args, timeout=15):
        result = subprocess.run([self.executable, *args], capture_output=True, env=self.env, timeout=timeout, check=False)
        if result.returncode:
            if args in (['start', 'cli-egress-gemini'], ['start', 'cli-egress-claude']) and b'RWLayer of container' in result.stderr and b'is unexpectedly nil' in result.stderr:
                raise GatewayError('ENGINE_LAYER_MISSING')
            raise GatewayError("ENGINE_FAILED")
        return result.stdout

    def inventory(self):
        return self.command(["ps", "-a", "--filter", "label=appraisal.cli-gateway=1", "--format", "{{.Names}}"] ).decode().splitlines()

    def inspect(self, name):
        data = json.loads(self.command(["inspect", name]))[0]
        return data["State"]

    def create(self, job, manifest, *, verification=False):
        name = container_name(job["jobId"], job["attemptNumber"])
        if verification:
            name = "cli-login-" + job["jobId"] + "-verify"
        runtime = job["runtimeRef"]
        if not re.fullmatch(r"cli-home-[0-9a-f-]{36}", runtime):
            raise GatewayError("INVALID_OUTPUT")
        if manifest.get("executionHostMode") == "codespaces-personal":
            if os.environ.get("CODESPACES") != "true" or manifest.get("customerReleaseApproved") is not False or runtime != manifest.get("personalRuntimeRef"):
                raise GatewayError("PERSONAL_RUNTIME_SCOPE_REQUIRED")
        registry_digest = re.fullmatch(r"[^\s]+@sha256:[0-9a-f]{64}", manifest["image"])
        local_personal_image = manifest.get("executionHostMode") == "codespaces-personal" and re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["image"])
        if not registry_digest and not local_personal_image:
            raise ValueError("Provider image must use an immutable digest")
        controls = []
        research = manifest.get('capabilityProfile') == RESEARCH_PROFILE
        if manifest.get('capabilityProfile') not in (None, RESEARCH_PROFILE, CLAUDE_PROFILE):
            raise ValueError('Unknown capability profile')
        if research and (job['provider'] != 'gemini' or manifest.get('executionHostMode') != 'codespaces-personal'):
            raise ValueError('Research profile requires the personal Google runtime')
        if manifest.get('capabilityProfile') == CLAUDE_PROFILE:
            from .network import regular_bytes
            if job['provider'] != 'claude' or manifest.get('cliRuntime') != 'claude-code':
                raise ValueError('Claude profile requires Claude Code')
            path = manifest.get('settingsFile', '')
            if json.loads(regular_bytes(path, manifest.get('policyDigest'))) != CLAUDE_POLICY:
                raise ValueError('Claude policy changed after review')
            controls += ['--mount', 'type=bind,source=' + path + ',target=/opt/gateway/claude-research-settings.json,readonly']
            controls += ['--env', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
                         '--env', 'ENABLE_CLAUDEAI_MCP_SERVERS=false', '--env', 'CLAUDE_CODE_DISABLE_ARTIFACT=1',
                         '--env', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY=1']
            for directory in ('projects', 'debug', 'plugins', 'agents', 'skills', 'commands'):
                controls += ['--tmpfs', '/home/agent/.claude/' + directory + ':rw,noexec,nosuid,size=16m,uid=1000,gid=1000']
        if job["provider"] == "gemini":
            if manifest.get("cliRuntime") != "antigravity":
                raise ValueError("An Antigravity-specific manifest is required")
            path = Path(manifest.get("settingsFile", ""))
            if not path.is_absolute() or path.resolve() != path or not path.is_file() or path.is_symlink():
                raise ValueError("An immutable operator settings file is required")
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != manifest.get("policyDigest"):
                raise ValueError("Antigravity settings changed after approval")
            policy = json.loads(raw)
            required = {"toolPermission": "strict", "allowNonWorkspaceAccess": False,
                        "enableTelemetry": False, "useG1Credits": False,
                        "permissions": {"allow": [], "ask": [], "deny": ["read_file(*)", "write_file(*)",
                          "read_url(*)", "execute_url(*)", "command(*)", "unsandboxed(*)", "mcp(*)"]}, "hooks": {}}
            if research:
                required = RESEARCH_POLICY
            if policy != required:
                raise ValueError("Antigravity tool policy must match the reviewed capability profile")
            agent = Path(manifest.get('agentFile', ''))
            if not agent.is_absolute() or agent.resolve() != agent or not agent.is_file() or agent.is_symlink():
                raise ValueError('Immutable reviewed agent file required')
            definition = agent.read_bytes()
            if definition != (RESEARCH_AGENT if research else GOOGLE_AGENT) or hashlib.sha256(definition).hexdigest() != manifest.get('agentDigest'):
                raise ValueError('Antigravity agent changed after review')
            controls = ["--mount", "type=bind,source=" + str(path) + ",target=/home/agent/.gemini/antigravity-cli/settings.json,readonly"]
            controls += ['--mount', 'type=bind,source=' + str(agent) + ',target=/work/.agents/agents/cli-gateway-text.md,readonly']
            # Official opt-out prevents startup network checks and updater locks;
            # the reviewed binary is immutable and upgraded only by the operator.
            controls += ["--env", "AGY_CLI_DISABLE_AUTO_UPDATE=true"]
            # The native runtime writes its project/conversation registry here.
            # An empty ephemeral directory excludes persisted global overrides;
            # the reviewed CLI settings and selected agent remain read-only.
            controls += ['--tmpfs', '/home/agent/.gemini/config:rw,noexec,nosuid,size=16m,uid=1000,gid=1000']
            controls += ['--mount', 'type=bind,source=' + str(agent) + ',target=/home/agent/.gemini/config/agents/cli-gateway-text.md,readonly']
            if research:
                controls = [value.replace('/cli-gateway-text.md,readonly', '/' + RESEARCH_AGENT_NAME + '.md,readonly') for value in controls]
            for suffix in (".gemini/antigravity-cli/plugins", ".agents", ".gemini/skills", ".gemini/extensions"):
                controls += ["--tmpfs", "/home/agent/" + suffix + ":ro,noexec,nosuid,size=1m,uid=1000,gid=1000,mode=0555"]
            controls += ["--tmpfs", "/home/agent/.gemini/antigravity-cli/brain:rw,noexec,nosuid,size=64m,uid=1000,gid=1000"]
        controls += network_controls(self, manifest)
        self.command(["create", "--name", name, "--label", "appraisal.cli-gateway=1", "--label", "appraisal.cli-kind=" + ("login_verification" if verification else "inference"),
            "--interactive", "--restart", "no", "--log-driver", "none", "--read-only",
            "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--cpus", "1", "--memory", "2g", "--pids-limit", "128",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--tmpfs", "/work:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
            "--mount", "type=volume,source=" + runtime + ",target=/home/agent",
            "--network", manifest["network"], "--workdir", "/work",
            "--env", "HOME=/home/agent",
            "--env", "LANG=C.UTF-8", *controls, manifest["image"], *invocation(job["provider"], capability_profile=manifest.get('capabilityProfile'), model_selection=job.get('modelSelection', 'provider-default'))])
        return name

    def start(self, name):
        # This method may be called ONCE for an attempt, after durable start-intent.
        return subprocess.Popen([self.executable, "start", "--attach", "--interactive", name],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)

    def stop(self, name):
        state = self.inspect(name)
        if state.get("Running"):
            try:
                self.command(["stop", "--time", "5", name], timeout=10)
            except (GatewayError, subprocess.TimeoutExpired):
                self.command(["kill", name])
        state = self.inspect(name)
        if state.get("Running") or state.get("Restarting"):
            raise GatewayError("STOP_UNCONFIRMED")
        return state

    def remove(self, name):
        self.command(["rm", name])


class Buffer:
    def __init__(self, limit):
        self.limit, self.data, self.exceeded = limit, bytearray(), False

    def read(self, pipe):
        try:
            while chunk := pipe.read(8192):
                if len(self.data) + len(chunk) > self.limit:
                    self.exceeded = True
                    return
                self.data.extend(chunk)
        finally:
            pipe.close()


class Runner:
    def __init__(self, engine, client, journal):
        self.engine, self.client, self.journal = engine, client, journal

    def run(self, job, manifest):
        ids = {k: job[k] for k in ("jobId", "attemptNumber", "leaseToken")}
        name = container_name(job["jobId"], job["attemptNumber"])
        identity = {**ids, "containerRef": name, "phase": "claimed"}
        # Journal before engine mutation, so a crash cannot leave an unknown container.
        self.journal.save(identity)
        self.engine.create(job, manifest)
        auth = self.client.call("authorizeStart", **ids, containerRef=name)
        if not auth.get("authorized"):
            self.engine.stop(name)
            return self._settle(ids, name, Result(error="CANCELLED"))
        identity["phase"] = "start_intent"
        self.journal.save(identity)
        process = self.engine.start(name)
        stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
        threads = [threading.Thread(target=b.read, args=(p,), daemon=True) for b, p in ((stdout, process.stdout), (stderr, process.stderr))]
        for thread in threads:
            thread.start()
        # Sending stdin concurrently prevents blocking the lease loop on a hung CLI.
        prompt = prompt_input(job["provider"], job["instructions"], job["inputText"])
        def send():
            try:
                process.stdin.write(prompt)
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        writer = threading.Thread(target=send, daemon=True)
        writer.start()
        started = time.monotonic()
        last_contact, next_heartbeat = started, started + HEARTBEAT_SECONDS
        failure = None
        failure_detail = None
        try:
            while process.poll() is None:
                now = time.monotonic()
                if stdout.exceeded or stderr.exceeded:
                    failure = "OUTPUT_LIMIT"
                    failure_detail = "stdout_bytes" if stdout.exceeded else "stderr_bytes"
                    break
                if now - started >= runtime_seconds(job['provider'], manifest.get('capabilityProfile')):
                    failure = "TIMEOUT"
                    break
                if now - last_contact >= 60 - LEASE_MARGIN_SECONDS:
                    failure = "OUTCOME_UNCERTAIN"
                    break
                if now >= next_heartbeat:
                    next_heartbeat = now + HEARTBEAT_SECONDS
                    try:
                        heartbeat = self.client.call("heartbeatJob", **ids)
                        last_contact = time.monotonic()
                        if heartbeat.get("stop"):
                            failure = heartbeat.get("reason") or "CANCELLED"
                            break
                    except (GatewayError, OSError):
                        pass
                time.sleep(0.1)
        finally:
            stopped_state = self.engine.stop(name)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            for thread in threads:
                thread.join(timeout=5)
            writer.join(timeout=1)
        if stdout.exceeded or stderr.exceeded:
            failure = "OUTPUT_LIMIT"
            failure_detail = "stdout_bytes" if stdout.exceeded else "stderr_bytes"
        if failure:
            result = Result(error=failure)
        else:
            try:
                # The attach client's status is not authoritative for the container.
                # Accept output only after both transport and the native process succeeded.
                exit_code = stopped_state.get("ExitCode")
                if type(exit_code) is not int:
                    raise GatewayError("OUTCOME_UNCERTAIN")
                if process.returncode and exit_code == 0:
                    raise GatewayError("CLI_FAILED")
                result = parse_result(job["provider"], bytes(stdout.data), bytes(stderr.data), exit_code,
                    tool_registry_digest=manifest.get('toolRegistryDigest'), capability_profile=manifest.get('capabilityProfile'))
                if manifest.get('capabilityProfile') == RESEARCH_PROFILE:
                    # Only after strict parsing: expose counts, never prompts,
                    # queries, returned page content, reasoning or credentials.
                    names = [event['step_update']['tool_info']['name']
                        for event in (json.loads(line) for line in bytes(stdout.data).splitlines() if line.strip())
                        if event.get('event') == 'step_update' and event['step_update'].get('step_type') == 'tool']
                    print(json.dumps({'event':'CLI_RESEARCH_COMPLETED','jobId':job['jobId'],
                        'toolNames':sorted(set(names)),'toolUpdates':len(names)}),flush=True)
            except GatewayError as exc:
                result = Result(error=exc.code)
                failure_detail = exc.detail
        if result.error:
            # Numeric counters and fixed categories only: no native output,
            # queries, prompts, stderr, tokens, or exception strings in logs.
            categories = {"stdout_bytes", "stderr_bytes", "event_bytes", "answer_bytes", "tool_steps"}
            print(json.dumps({'event': 'CLI_RUN_FAILED', 'jobId': job['jobId'],
                'errorCode': result.error, 'limit': failure_detail if failure_detail in categories else None,
                'stdoutBytes': len(stdout.data), 'stderrBytes': len(stderr.data),
                'protocol': stream_diagnostics(bytes(stdout.data)) if job['provider']=='gemini' else None}), flush=True)
        return self._settle(ids, name, result)

    def _settle(self, ids, name, result):
        # Retry control-plane delivery only. No second provider invocation.
        delay = 1
        while True:
            try:
                receipt = self.client.call("complete", **ids, containerRef=name, stopped=True, result=result.payload())
                break
            except (GatewayError, OSError):
                time.sleep(delay)
                delay = min(delay * 2, 10)
        self.engine.remove(name)
        self.journal.clear()
        return receipt
