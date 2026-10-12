"""Restore the approved personal Antigravity worker after a Codespaces stop.

Restarts only the existing reviewed relay, restores the already-approved scoped
firewall rule, verifies routing, then runs the normal supervisor. No inference,
new credentials, provider enablement, host undraining, or automatic replay.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from cli_gateway.client import Client
from cli_gateway.main import main as supervise, manifests, recover
from cli_gateway.recovery import Journal
from cli_gateway.runner import Docker
from cli_gateway.startup import restore_image, restore_relay

STAGE = 'configuration'


def main():
    global STAGE
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config = Path(args.config)
    if (os.environ.get('CODESPACES') != 'true' or not config.is_absolute() or not config.is_file()
        or config.is_symlink() or config.stat().st_mode & 0o077):
        raise ValueError('Private personal Codespaces configuration required')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
    allowed = {'CLI_WORKER_URL', 'CLI_HOST_ID', 'CLI_DATA_DIR', 'CLI_MANIFEST_DIR', 'CLI_HOST_SECRET_FILE',
               'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR', 'CLI_LOGIN_MANIFEST_DIR', 'CLI_MAPS_CONFIG_DIR'}
    if set(values) - allowed:
        raise ValueError('Unsupported configuration setting')
    os.environ.update(values)
    secret = Path(values['CLI_HOST_SECRET_FILE'])
    if not secret.is_file() or secret.is_symlink() or secret.stat().st_mode & 0o077:
        raise ValueError('Private host authentication required')
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], secret.read_text().strip())
    data = Path(values['CLI_DATA_DIR'])
    approved = manifests(values['CLI_MANIFEST_DIR'])
    if len(approved) != 1:
        raise ValueError('One reviewed personal runtime required')
    entry = next(iter(approved.values()))
    if entry.get('personalExperimentApproved') is not True or entry.get('provider') != 'gemini':
        raise ValueError('Only the reviewed personal Google experiment is covered')
    engine = Docker()
    STAGE = 'exclusive-lock'
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        STAGE = 'interrupted-work-recovery'
        # Recover interrupted maintenance before inference. Recovery stops known
        # containers, never replays a code or prompt, and retains drain/quarantine.
        if values.get('CLI_LOGIN_MANIFEST_DIR'):
            from cli_gateway.login_recovery import recover_login
            recover_login(engine, client, Journal(data / 'login-journal'))
        if values.get('CLI_MAPS_CONFIG_DIR'):
            from cli_gateway.maps_config import MapsStore, recover_setup
            recover_setup(engine, client, Journal(data / 'setup-journal'), MapsStore(values['CLI_MAPS_CONFIG_DIR']))
        recover(engine, client, Journal(data / 'journal'))
        if engine.inventory():
            raise ValueError('Stopped inventory required before network restoration')
        STAGE = 'approved-image-restore'
        restore_image(engine, entry, data)
        STAGE = 'approved-relay-restore'
        restore_relay(engine, entry)
    scripts = Path(__file__).resolve().parent
    # Each reviewed child takes the same lock independently. No shell expansion.
    for name in ('repair-codespaces-network.py', 'verify-egress.py'):
        STAGE = name.removesuffix('.py')
        before = set(data.glob('cli-egress-probe-*.json'))
        result = subprocess.run([sys.executable, str(scripts / name), '--config', str(config),
                                 '--egress', entry['egressFile']], check=False)
        if result.returncode:
            raise ValueError('Scoped network restoration failed')
        if name == 'verify-egress.py':
            fresh = set(data.glob('cli-egress-probe-*.json')) - before
            if len(fresh) != 1:
                raise ValueError('Fresh network evidence required')
            network = json.loads(next(iter(fresh)).read_text())
            if (network.get('networkChecksPassed') is not True or network.get('privateCanaryPositiveControl') is not True
                or network.get('egressDigest') != entry['egressDigest'] or len(network.get('tests', {})) != 15
                or any(value is not True for value in network['tests'].values())):
                raise ValueError('Fresh network checks did not pass')
    STAGE = 'supervisor'
    print('Personal Antigravity worker starting. Codespaces can stop when idle.', flush=True)
    supervise()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(f'Personal worker resume stopped safely at {STAGE}. Operator review required; no prompt was replayed.', flush=True)
        raise SystemExit(1) from None
