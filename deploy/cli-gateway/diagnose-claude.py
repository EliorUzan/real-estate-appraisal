"""One synthetic Claude health probe, with fixed-category diagnostics only.

Requires a drained idle personal host and the supervisor lock. Does not replay
jobs, change approvals, or retain native output or credentials.
"""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import uuid

from cli_gateway.adapters.base import claude_diagnostics
from cli_gateway.client import Client
from cli_gateway.contracts import MAX_STDOUT, MAX_STDERR
from cli_gateway.main import manifests
from cli_gateway.recovery import Journal
from cli_gateway.runner import Buffer, Docker


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--show-synthetic-error', action='store_true',
                        help='Print a bounded redacted error from the fixed public probe only')
    args = parser.parse_args()
    path = Path(args.config)
    if (os.environ.get('CODESPACES') != 'true' or not path.is_absolute()
            or path.is_symlink() or path.stat().st_mode & 0o077):
        raise ValueError('PRIVATE_PERSONAL_CONFIGURATION_REQUIRED')
    values = dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):
        os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    secret = Path(values['CLI_HOST_SECRET_FILE'])
    if secret.is_symlink() or secret.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_HOST_AUTHENTICATION_REQUIRED')
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], secret.read_text().strip())
    approved = manifests(values['CLI_MANIFEST_DIR'])
    entry = next(value for value in approved.values() if value['provider'] == 'claude')
    data, engine = Path(values['CLI_DATA_DIR']), Docker()
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (engine.inventory() or any(Journal(data / name).load() for name in ('journal', 'login-journal', 'setup-journal'))
                or not client.call('heartbeatHost', manifests=list(approved)).get('drain')
                or client.call('getAssignment').get('job')):
            raise ValueError('DRAINED_IDLE_HOST_REQUIRED')
        job = dict(jobId=str(uuid.uuid4()), attemptNumber=1, provider='claude', runtimeRef=entry['personalRuntimeRef'])
        name = engine.create(job, entry, verification=True)
        process = None
        try:
            process = engine.start(name)
            stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
            readers = [threading.Thread(target=b.read, args=(pipe,), daemon=True)
                       for b, pipe in ((stdout, process.stdout), (stderr, process.stderr))]
            for reader in readers:
                reader.start()
            process.stdin.write(b'Reply only CONNECTION_OK. Do not use any tools.\n')
            process.stdin.close()
            timeout = False
            try:
                code = process.wait(timeout=90)
            except subprocess.TimeoutExpired:
                timeout, code = True, None
                engine.stop(name)
                process.wait(timeout=10)
            for reader in readers:
                reader.join(timeout=5)
            if args.show_synthetic_error and not stdout.exceeded:
                try:
                    final = json.loads(bytes(stdout.data))
                    if isinstance(final, dict) and final.get('is_error') is True:
                        # This script never accepts user prompts. Inspect only the
                        # fixed probe's failure; strip URLs, emails and token-like values.
                        detail = str(final.get('result', ''))
                        detail = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+|[A-Za-z0-9_+/=-]{24,}', '[redacted]', detail)
                        print(json.dumps({'syntheticError': detail[:1200]}), flush=True)
                except (ValueError, UnicodeError):
                    pass
            print(json.dumps(dict(event='CLAUDE_HEALTH_PROBE', exitCode=code, timeout=timeout,
                                  stdoutBytes=len(stdout.data), stderrBytes=len(stderr.data),
                                  outputLimit=stdout.exceeded or stderr.exceeded,
                                  protocol=claude_diagnostics(bytes(stdout.data)))), flush=True)
        finally:
            engine.stop(name)
            engine.remove(name)
            if process is not None and process.poll() is None:
                process.wait(timeout=10)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Claude probe stopped safely: ' + type(error).__name__, flush=True)
        raise SystemExit(1) from None
