"""Strict terminal parsers: process exit zero alone is never a successful result."""
import hashlib
import json
import re
from ..contracts import GatewayError, Result, MAX_STDOUT, MAX_STDERR, MAX_EVENT, answer, count, model, runtime_seconds
from ..research import PROFILE, WEB_TOOLS, AGENT_NAME

PROVIDERS = frozenset({"claude", "openai", "gemini"})


def native_error_tags(value):
    """Diagnostic categories, not authoritative error-code classification."""
    text = json.dumps(value, ensure_ascii=True).lower() if value else ''
    patterns = {
        'quota': ('quota', 'resource_exhausted', 'resource exhausted'),
        'rate_limit': ('rate limit', 'too many requests', '429'),
        'authentication': ('unauthenticated', 'authentication required', 'invalid credential'),
        'permission': ('permission', 'not allowed', 'access denied'),
        'context_limit': ('context length', 'context window', 'token limit'),
        'tool_limit': ('tool call limit', 'maximum number', 'max iterations', 'step limit'),
        'tool_call': ('tool call', 'function call'),
        'timeout': ('timeout', 'timed out', 'deadline'),
        'unavailable': ('unavailable', '503', '502', 'overloaded'),
        'internal': ('internal error', 'internal server', '500'),
        'network': ('connection', 'network', 'fetch failed'),
        'safety': ('safety', 'blocked content', 'prohibited'),
    }
    return [tag for tag, words in patterns.items() if any(word in text for word in words)]


def stream_diagnostics(stdout):
    """Fixed protocol counters only; never retain any native text or identifiers."""
    data = {'events': 0, 'toolUpdates': 0, 'toolSteps': 0, 'invalidIndexes': 0,
            'terminalStatus': None, 'turns': None, 'answerBytes': None, 'nativeError': False,
            'nativeErrorTags': [], 'nativeDurationSeconds': None, 'toolErrorUpdates': 0}
    indexes = set()
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
            data['events'] += 1
            if event.get('event') == 'step_update':
                step = event.get('step_update') or {}
                if step.get('step_type') == 'tool':
                    data['toolUpdates'] += 1
                    if (step.get('tool_info') or {}).get('error'): data['toolErrorUpdates'] += 1
                    index = step.get('step_index')
                    if type(index) is int and index >= 0: indexes.add(index)
                    else: data['invalidIndexes'] += 1
            if event.get('event') == 'result':
                final = event.get('result') or {}
                state = final.get('status')
                data['terminalStatus'] = state if state in ('SUCCESS','ERROR','CANCELED','CANCELLED','INTERRUPTED','TIMEOUT','INVALID','WAITING','RUNNING') else 'UNKNOWN'
                turns = final.get('num_turns')
                data['turns'] = turns if type(turns) is int and 0 <= turns <= 10000 else None
                response = final.get('response')
                data['answerBytes'] = len(response.encode('utf-8')) if isinstance(response,str) else None
                data['nativeError'] = bool(final.get('error'))
                data['nativeErrorTags'] = native_error_tags(final.get('error'))
                duration=final.get('duration_seconds')
                if type(duration) in (int,float) and 0 <= duration <= 86400: data['nativeDurationSeconds']=round(duration,2)
        except (ValueError, TypeError, AttributeError, UnicodeError):
            continue
    data['toolSteps'] = len(indexes)
    return data


def invocation(provider, *, capability_profile=None):
    # Policy/config is baked into the approved image, never provided by a customer.
    if provider == "claude":
        return ["claude", "-p", "--output-format", "json", "--tools", "",
                "--disallowedTools", "mcp__*", "--strict-mcp-config", "--mcp-config", "{}",
                "--setting-sources", "", "--settings", "/opt/gateway/claude-settings.json"]
    if provider == "openai":
        return ["codex", "exec", "--json", "--skip-git-repo-check", "--ephemeral",
                "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
                "-c", "features.shell_tool=false", "-c", "features.unified_exec=false",
                "-c", "features.multi_agent=false", "-c", "features.hooks=false",
                "-c", "agents.enabled=false", "-c", 'web_search="disabled"', "-"]
    if provider == "gemini":
        # 'gemini' is the stable Google slot in the API/database. Its native
        # runtime is Antigravity; one framed stdin turn avoids prompt arguments.
        return ["agy", "--input-format", "stream-json", "--output-format", "stream-json",
                "--print-timeout", f"{runtime_seconds(provider, capability_profile) - 30}s", "--disable-slash-commands", "--log-file", "/dev/null", '--agent', AGENT_NAME if capability_profile == PROFILE else 'cli-gateway-text']
    raise GatewayError("INVALID_OUTPUT")


def parse_result(provider, stdout: bytes, stderr: bytes, exit_code: int, *, tool_registry_digest=None, capability_profile=None):
    if len(stdout) > MAX_STDOUT or len(stderr) > MAX_STDERR:
        raise GatewayError("OUTPUT_LIMIT", detail="stdout_bytes" if len(stdout) > MAX_STDOUT else "stderr_bytes")
    # Do not classify auth/quota from free-form stderr; changes must have tested fixtures.
    if exit_code != 0:
        raise GatewayError("TIMEOUT" if exit_code == 124 else "CLI_FAILED")
    try:
        decoded = stdout.decode("utf-8", errors="strict")
        if provider == "openai":
            return _codex(decoded)
        if provider == "gemini":
            return _antigravity(decoded, tool_registry_digest, capability_profile)
        data = json.loads(decoded)
        if not isinstance(data, dict):
            raise ValueError()
        if provider == "claude":
            if data.get("type") != "result" or data.get("subtype") != "success" or data.get("is_error") is not False:
                raise ValueError()
            usage = data.get("usage") or {}
            return Result(answer(data.get("result")), model(data.get("model")),
                          count(usage.get("input_tokens")), count(usage.get("output_tokens")))
        raise ValueError()
    except (ValueError, TypeError, AttributeError, KeyError, UnicodeError):
        raise GatewayError("INVALID_OUTPUT") from None


def prompt_input(provider, instructions, text):
    prompt = instructions + "\n\n" + text
    if provider == "gemini":
        return (json.dumps({"event": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n").encode("utf-8")
    if provider not in PROVIDERS:
        raise GatewayError("INVALID_OUTPUT")
    return prompt.encode("utf-8")


def _antigravity(decoded, tool_registry_digest=None, capability_profile=None):
    if capability_profile not in (None, PROFILE):
        raise ValueError()
    research = capability_profile == PROFILE
    if research and tool_registry_digest is None:
        raise ValueError()
    tool_steps = set()
    unindexed_tool_updates = 0
    final = None
    initialized = False
    for line in decoded.splitlines():
        if not line.strip():
            continue
        if len(line.encode("utf-8")) > MAX_EVENT:
            raise GatewayError("OUTPUT_LIMIT", detail="event_bytes")
        event = json.loads(line)
        if not isinstance(event, dict) or final is not None:
            raise ValueError()
        kind = event.get("event")
        if kind == "init":
            if initialized or not isinstance(event.get("init"), dict):
                raise ValueError()
            info = event["init"]
            # Antigravity 1.3.3 reports its registered tools here, even for a
            # custom agent with no selected tools. Accept only a fingerprint
            # reviewed with native deny enforcement; never arbitrary registries.
            tools = info.get('tools')
            if tool_registry_digest is None:
                registry_matches = tools == []
            else:
                registry_matches = (isinstance(tool_registry_digest, str)
                    and re.fullmatch(r'[0-9a-f]{64}', tool_registry_digest)
                    and isinstance(tools, list) and all(isinstance(tool, str) for tool in tools)
                    and hashlib.sha256(json.dumps(tools, sort_keys=True, separators=(',', ':'),
                        ensure_ascii=False).encode()).hexdigest() == tool_registry_digest)
            if not registry_matches or info.get("agent") != (AGENT_NAME if research else "cli-gateway-text") or info.get("permission_mode") != "strict":
                raise ValueError()
            initialized = True
        elif kind == "step_update":
            if not initialized or not isinstance(event.get("step_update"), dict):
                raise ValueError()
            step = event["step_update"]
            if step.get('subagent_info') or step.get('tool_call') or step.get('tool_result'):
                raise ValueError()
            if step.get('step_type') == 'tool' or step.get('tool_info'):
                info = step.get('tool_info')
                if (not research or step.get('step_type') != 'tool' or not isinstance(info, dict)
                    or info.get('name') not in WEB_TOOLS or step.get('tool_name') != info['name']):
                    raise ValueError()
                # Native 1.3.3 emits multiple updates (ACTIVE/DONE, etc.) for
                # one indexed step. Count actual steps, not stream updates.
                # Still validate the tool policy on every update above.
                index = step.get('step_index')
                if index is None:
                    unindexed_tool_updates += 1
                elif type(index) is not int or index < 0:
                    raise ValueError()
                else:
                    tool_steps.add(index)
                if len(tool_steps) + unindexed_tool_updates > 64:
                    raise GatewayError('OUTPUT_LIMIT', detail='tool_steps')
        elif kind == "result":
            final = event.get("result")
            if (not isinstance(final, dict) or final.get("status") not in ('SUCCESS', 'ERROR')
                or type(final.get("num_turns")) is not int or final["num_turns"] != 1):
                raise ValueError()
        else:
            raise ValueError()
    if not initialized or final is None:
        raise ValueError()
    # A valid native failure envelope is an agent execution failure, even when
    # the attach process exits zero. Never publish its partial response.
    if final['status'] == 'ERROR':
        raise GatewayError('CLI_FAILED')
    if final.get('error'):
        raise ValueError()
    usage = final.get("usage") or {}
    # This envelope does not guarantee a resolved model field.
    return Result(answer(final.get("response")), None,
                  count(usage.get("input_tokens")), count(usage.get("output_tokens")))


def _codex(decoded):
    final = None
    usage = {}
    completed = False
    for line in decoded.splitlines():
        if not line.strip():
            continue
        if len(line.encode("utf-8")) > MAX_EVENT:
            raise GatewayError("OUTPUT_LIMIT")
        event = json.loads(line)
        if not isinstance(event, dict) or completed:
            raise ValueError()
        kind = event.get("type")
        if kind in {"error", "turn.failed"}:
            raise ValueError()
        if kind == "item.completed" and (event.get("item") or {}).get("type") == "agent_message":
            final = event["item"].get("text")
        if kind == "turn.completed":
            completed = True
            usage = event.get("usage") or {}
    if not completed:
        raise ValueError()
    return Result(answer(final), None, count(usage.get("input_tokens")), count(usage.get("output_tokens")))
