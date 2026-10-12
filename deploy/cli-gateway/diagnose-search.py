"""Bounded, operator-only search check using an already approved account home.

Requires a drained, idle worker and its exclusive lock. Emits fixed counters and
error categories only. Does not save native output or change runtime approvals.
"""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import time
import uuid

from cli_gateway.adapters import prompt_input, parse_result
from cli_gateway.adapters.base import stream_diagnostics
from cli_gateway.client import Client
from cli_gateway.contracts import MAX_STDOUT, MAX_STDERR, GatewayError
from cli_gateway.main import manifests
from cli_gateway.personal_accounts import load_account_bindings, manifest_for_job
from cli_gateway.recovery import Journal
from cli_gateway.runner import Buffer, Docker


def diagnostic_text(value):
    """Operator-only synthetic task diagnostics, never used for customer jobs."""
    text = json.dumps(value, ensure_ascii=False)
    text = re.sub(r'https?://\S+', '[url]', text)
    text = re.sub(r'[\w.+-]+@[\w.-]+', '[email]', text)
    text = re.sub(r'(?i)(bearer\s+|(?:token|secret|password|authorization|api[_-]?key)[\s"\x27:=]+)\S+', '[credential]', text)
    text = re.sub(r'[A-Za-z0-9_+/=-]{32,}', '[opaque]', text)
    return text[:1200]


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--connection', required=True)
    parser.add_argument('--task', choices=['unesco', 'hebrew-search', 'public-report'], default='unesco')
    args = parser.parse_args()
    config = Path(args.config)
    if not config.is_absolute() or config.is_symlink() or config.stat().st_mode & 0o077:
        raise ValueError('Private config required')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'): os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    secret = Path(values['CLI_HOST_SECRET_FILE'])
    if secret.is_symlink() or secret.stat().st_mode & 0o077: raise ValueError('Private credential required')
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], secret.read_text().strip())
    data = Path(values['CLI_DATA_DIR'])
    approved = manifests(values['CLI_MANIFEST_DIR'])
    bindings = load_account_bindings(values['CLI_MANIFEST_DIR'], approved)
    digest, base = next(iter(approved.items()))
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        engine = Docker()
        if engine.inventory() or Journal(data / 'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('Idle runtime required')
        if not client.call('heartbeatHost', manifests=[]).get('drain'): raise ValueError('Drain host first')
        # getMaintenance deliberately omits connected accounts. Select only an
        # explicitly operator-approved additional-account binding; never accept
        # a volume name or credentials from the command line.
        account = next(entry for entry in bindings.values()
                       if entry['accountConnectionId'] == args.connection and entry['provider'] == 'gemini')
        job = dict(jobId=str(uuid.uuid4()), attemptNumber=1, provider='gemini',
                   runtimeRef=account['personalRuntimeRef'], manifestDigest=digest)
        manifest = manifest_for_job(job, base, bindings)
        name = engine.create(job, manifest)
        try:
            process = engine.start(name)
            stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
            readers = [threading.Thread(target=b.read, args=(pipe,), daemon=True)
                       for b, pipe in ((stdout, process.stdout), (stderr, process.stderr))]
            for thread in readers: thread.start()
            task = (
                'Use search_web once to find the official UNESCO page for the White City of Tel Aviv. '
                'Return its title and URL. If the search fails, say that it failed; do not repeat the search.'
                if args.task == 'unesco' else
                'Use search_web to look up the public Hadera city hall at Rothschild 21, Hadera, Israel. '
                'Search in Hebrew for its address and neighborhood. Make at most three searches. '
                'Return verified facts and source URLs in Hebrew. If a search fails, report that failure and stop.')
            instructions = 'Diagnostic connectivity test.'
            if args.task == 'public-report':
                instructions = json.loads((Path(__file__).resolve().parents[2] / 'supabase/functions/appraisal/catalog.json').read_text())['defaultPrompt']
                task = 'כתובת הנכס: רוטשילד 21, חדרה\n\nדוגמת סגנון (לא עובדות על הנכס החדש):\n\n\nבקשה נוספת:\n'
            process.stdin.write(prompt_input('gemini', instructions, task))
            process.stdin.close()
            deadline = time.monotonic() + (600 if args.task == 'public-report' else 90)
            while process.poll() is None and time.monotonic() < deadline and not stdout.exceeded and not stderr.exceeded:
                time.sleep(.1)
            state = engine.stop(name)
            process.wait(timeout=10)
            for thread in readers: thread.join(timeout=5)
            raw = bytes(stdout.data)
            tools = []
            for line in raw.splitlines():
                try: event = json.loads(line)
                except ValueError: continue
                step = event.get('step_update') or {}
                if step.get('step_type') != 'tool': continue
                info = step.get('tool_info') or {}
                detail = json.dumps(info.get('error') or {}).lower()
                categories = [category for category, phrases in {
                    'permission': ('denied','not allowed','forbidden'),
                    'quota': ('quota','resource_exhausted','rate limit'),
                    'network': ('connection','timeout','proxy','network','tls'),
                    'auth': ('unauthenticated','authentication','credential'),
                    'schema': ('invalid argument','required','schema','parameter'),
                }.items() if any(phrase in detail for phrase in phrases)]
                tools.append(dict(search=info.get('name') == 'search_web', error=bool(info.get('error')),
                    done=step.get('state') == 'DONE', categories=categories,
                    outputPresent=bool(info.get('output')),
                    errorDetail=diagnostic_text(info['error']) if info.get('error') else None))
            finals = [json.loads(line).get('result', {}) for line in raw.splitlines()
                      if line.startswith(b'{') and json.loads(line).get('event') == 'result']
            try:
                result = parse_result('gemini', raw, bytes(stderr.data), state.get('ExitCode'),
                    tool_registry_digest=manifest['toolRegistryDigest'], capability_profile=manifest['capabilityProfile'])
                parsed = True
                source = 'whc.unesco.org' in result.text
            except GatewayError:
                parsed, source = False, False
            print(json.dumps(dict(event='SEARCH_DIAGNOSTIC', connection=args.connection,
                nativeExit=state.get('ExitCode'), parsed=parsed, unescoSource=source,
                protocol=stream_diagnostics(raw), tools=tools,
                errors=[diagnostic_text(f['error']) for f in finals if f.get('error')],
                stderrDetail=diagnostic_text(bytes(stderr.data).decode('utf-8', errors='replace')))), flush=True)
        finally:
            engine.stop(name)
            engine.remove(name)


if __name__ == '__main__':
    try: main()
    except Exception:
        print('Search diagnostic failed safely; inspect runtime state before resuming.', flush=True)
        raise SystemExit(1) from None
