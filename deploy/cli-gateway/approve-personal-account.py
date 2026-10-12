"""Approve one additional explicitly owned home on the unchanged personal image.

Requires fresh account-specific native search/read-denial and network reports.
Never copies credentials, edits the base approval, connects a database account,
changes the image/tools, or enables customer/browser onboarding.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import uuid
from cli_gateway.client import Client
from cli_gateway.main import manifests, personal_approval
from cli_gateway.personal_accounts import load_account_bindings
from cli_gateway.recovery import Journal
from cli_gateway.research import AGENT, CHECKS, PROFILE
from cli_gateway.runner import Docker


def read(value):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private regular operator file required')
    return path.read_bytes()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('config', 'connection', 'owner'): parser.add_argument('--' + name, required=True)
    parser.add_argument('--revision', type=int, required=True)
    args = parser.parse_args()
    if os.environ.get('CODESPACES') != 'true' or str(uuid.UUID(args.owner)) != args.owner:
        raise ValueError('Explicit personal Codespaces owner required')
    values = dict(line.split('=', 1) for line in read(args.config).decode().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'): os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    approved = manifests(values['CLI_MANIFEST_DIR'])
    if len(approved) != 1: raise ValueError('One unchanged base approval required')
    base_digest, base = next(iter(approved.items()))
    if base.get('capabilityProfile') != PROFILE: raise ValueError('Existing reviewed research profile required')
    data = Path(values['CLI_DATA_DIR'])
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], read(values['CLI_HOST_SECRET_FILE']).decode().strip())
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        engine = Docker()
        if engine.inventory() or Journal(data / 'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('Resolve active native work first')
        if not client.call('heartbeatHost', manifests=[]).get('drain'): raise ValueError('Drain the host first')
        connection = next((c for c in client.call('getMaintenance')['connections']
            if c['id'] == args.connection and c['revision'] == args.revision
            and c['provider'] == 'gemini' and c['status'] == 'pending_setup'), None)
        if not connection or connection['runtimeRef'] == base['personalRuntimeRef']:
            raise ValueError('Separate pending account home required')
        scope = {key: base[key] for key in ('provider', 'cliRuntime', 'version', 'image',
            'policyDigest', 'agentDigest', 'egressDigest', 'toolRegistryDigest', 'capabilityProfile')}
        scope['personalRuntimeRef'] = connection['runtimeRef']
        earliest = datetime.now(timezone.utc) - timedelta(hours=1)
        reports = []
        for path in data.glob('research-probe-*.json'):
            report = json.loads(read(path))
            if (report.get('connectionId') == args.connection and report.get('revision') == args.revision
                and all(report.get(k) == scope[k] for k in ('image', 'personalRuntimeRef', 'policyDigest', 'agentDigest', 'egressDigest', 'toolRegistryDigest'))
                and datetime.fromisoformat(report['checkedAt']) >= earliest): reports.append((path, report))
        def latest(mode): return max((pair for pair in reports if pair[1].get('mode') == mode), key=lambda pair: pair[0].stat().st_mtime)
        search_path, search = latest('search'); denial_path, denial = latest('canary')
        def success(report):
            return (report.get('stopped') is True and report.get('nativeExitCode') == 0 and report.get('nativeStatus') == 'SUCCESS'
                and report.get('numTurns') == 1 and report.get('agent') == 'cli-gateway-research' and report.get('permissionMode') == 'strict'
                and report.get('diagnostics', {}).get('subagentStepCount') == 0)
        networks = []
        for path in data.glob('cli-egress-probe-*.json'):
            report = json.loads(read(path))
            if (path.stat().st_mtime >= earliest.timestamp() and report.get('egressDigest') == scope['egressDigest']
                and report.get('networkChecksPassed') is True and report.get('privateCanaryPositiveControl') is True
                and len(report.get('tests', {})) == 15 and all(v is True for v in report['tests'].values())): networks.append(path)
        network_path = max(networks, key=lambda path: path.stat().st_mtime)
        checks = {'nativeAccountVerified': success(search), 'agentSelected': success(search) and success(denial),
            'networkChecksPassed': bool(network_path), 'webSearchVerified': search.get('parserVerified') is True
                and search.get('hasUnescoSource') is True and any(s.get('name') == 'search_web' and s.get('state') == 'DONE' for s in search.get('toolSteps', [])),
            'nativeReadDenied': denial.get('canaryLeaked') is False and denial.get('diagnostics', {}).get('deniedToolStepCount', 0) > 0
                and denial.get('diagnosticAgentDigest') == digest(AGENT.replace(b'tools: [search_web]', b'tools: [view_file]'))}
        if set(checks) != CHECKS or not all(checks.values()): raise ValueError('Fresh account verification did not pass')
        identity = dict(baseManifestDigest=base_digest, accountConnectionId=args.connection,
            accountOwnerId=args.owner, accountRevision=args.revision)
        evidence = {**scope, **identity, 'checkedAt': datetime.now(timezone.utc).isoformat(),
            'checks': checks, 'customerReleaseApproved': False,
            'sourceReports': [{'file': str(p), 'digest': digest(read(p))} for p in (search_path, denial_path, network_path)]}
        evidence_path = data / ('account-evidence-' + args.connection + '.json')
        with evidence_path.open('x') as output:
            evidence_path.chmod(0o600); json.dump(evidence, output, indent=2)
        entry = {**base, **identity, 'personalRuntimeRef': connection['runtimeRef'],
            'evidenceFile': str(evidence_path), 'evidenceDigest': digest(read(evidence_path))}
        personal_approval(entry)
        folder = Path(values['CLI_MANIFEST_DIR']) / 'accounts'
        if folder.is_symlink(): raise ValueError('Regular private account directory required')
        folder.mkdir(mode=0o700, exist_ok=True)
        target = folder / (args.connection + '.json')
        with target.open('x') as output:
            target.chmod(0o600); json.dump(entry, output, indent=2)
        bindings = load_account_bindings(values['CLI_MANIFEST_DIR'], approved)
        if (base_digest, connection['runtimeRef']) not in bindings: raise ValueError('Account approval failed validation')
        print(json.dumps({'connectionId': args.connection, 'revision': args.revision,
            'baseManifestDigest': base_digest, 'accountBindingDigest': digest(read(target)),
            'image': base['image'], 'customerReleaseApproved': False}))


if __name__ == '__main__':
    try: main()
    except Exception:
        print('Additional account approval stopped. Keep the host drained and review scoped evidence.', flush=True)
        raise SystemExit(1) from None
