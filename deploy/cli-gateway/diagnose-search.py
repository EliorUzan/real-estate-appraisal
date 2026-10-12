"""Bounded, operator-only search check using an already approved account home.

Requires a drained, idle worker and its exclusive lock. Emits fixed counters and
error categories only. Does not save native output or change runtime approvals.
"""
import argparse
import json
import os
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


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--connection', required=True)
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
        account = next(c for c in client.call('getMaintenance')['connections']
                       if c['id'] == args.connection and c['provider'] == 'gemini' and c['status'] == 'connected')
        job = dict(jobId=str(uuid.uuid4()), attemptNumber=1, provider='gemini',
                   runtimeRef=account['runtimeRef'], manifestDigest=digest)
        manifest = manifest_for_job(job, base, bindings)
        name = engine.create(job, manifest)
        try:
            process = engine.start(name)
            stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
            readers = [threading.Thread(target=b.read, args=(pipe,), daemon=True)
                       for b, pipe in ((stdout, process.stdout), (stderr, process.stderr))]
            for thread in readers: thread.start()
            process.stdin.write(prompt_input('gemini', 'Diagnostic connectivity test.',
                'Use search_web once to find the official UNESCO page for the White City of Tel Aviv. '
                'Return its title and URL. If the search fails, say that it failed; do not repeat the search.'))
            process.stdin.close()
            deadline = time.monotonic() + 90
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
                    outputPresent=bool(info.get('output'))))
            try:
                result = parse_result('gemini', raw, bytes(stderr.data), state.get('ExitCode'),
                    tool_registry_digest=manifest['toolRegistryDigest'], capability_profile=manifest['capabilityProfile'])
                parsed = True
                source = 'whc.unesco.org' in result.text
            except GatewayError:
                parsed, source = False, False
            print(json.dumps(dict(event='SEARCH_DIAGNOSTIC', connection=args.connection,
                nativeExit=state.get('ExitCode'), parsed=parsed, unescoSource=source,
                protocol=stream_diagnostics(raw), tools=tools)), flush=True)
        finally:
            engine.stop(name)
            engine.remove(name)


if __name__ == '__main__':
    try: main()
    except Exception:
        print('Search diagnostic failed safely; inspect runtime state before resuming.', flush=True)
        raise SystemExit(1) from None
