"""Reapprove the same personal search capability after a pinned image rebuild.

Requires fresh real search, native read-denial and network evidence. Does not
change account, tools, prompts, provider flags, database registry or host drain.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
from cli_gateway.client import Client
from cli_gateway.main import manifests, personal_approval
from cli_gateway.network import controls
from cli_gateway.personal_accounts import load_account_bindings, IDENTITY
from cli_gateway.recovery import Journal
from cli_gateway.research import AGENT, CHECKS, PROFILE
from cli_gateway.runner import Docker


def read(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private regular operator file required')
    return path.read_bytes()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--candidate', required=True)
    args = parser.parse_args()
    if os.environ.get('CODESPACES') != 'true':
        raise ValueError('Personal Codespaces only')
    values = dict(line.split('=', 1) for line in read(args.config).decode().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):
        os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    approved = manifests(values['CLI_MANIFEST_DIR'])
    if len(approved) != 1:
        raise ValueError('One existing reviewed runtime required')
    original_digest, original = next(iter(approved.items()))
    bindings = load_account_bindings(values['CLI_MANIFEST_DIR'], approved)
    candidate = json.loads(read(args.candidate))
    if original.get('capabilityProfile') != PROFILE or set(original) != set(candidate):
        raise ValueError('Existing search profile required')
    if any(candidate[key] != value for key, value in original.items() if key not in ('image', 'egressDigest')):
        raise ValueError('Rebuild cannot change account, tools or other settings')
    data = Path(values['CLI_DATA_DIR'])
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], read(values['CLI_HOST_SECRET_FILE']).decode().strip())
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        engine = Docker()
        if engine.inventory() or Journal(data / 'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('Unresolved native work exists')
        if not client.call('heartbeatHost', manifests=[]).get('drain'):
            raise ValueError('Drain the host before rotating the runtime')
        controls(engine, candidate)
        def verify(candidate):
            scope = {key: candidate[key] for key in ('provider', 'cliRuntime', 'version', 'image', 'personalRuntimeRef',
                     'policyDigest', 'agentDigest', 'egressDigest', 'toolRegistryDigest', 'capabilityProfile')}
            earliest = datetime.now(timezone.utc) - timedelta(hours=1)
            reports = []
            for path in data.glob('research-probe-*.json'):
                report = json.loads(read(path))
                if (all(report.get(key) == scope[key] for key in ('image', 'personalRuntimeRef', 'policyDigest', 'agentDigest', 'egressDigest', 'toolRegistryDigest'))
                        and (not candidate.get('accountConnectionId') or (report.get('connectionId') == candidate['accountConnectionId'] and report.get('revision') == candidate['accountRevision']))
                        and datetime.fromisoformat(report['checkedAt']) >= earliest):
                    reports.append((path, report))
            def latest(mode):
                return max((pair for pair in reports if pair[1].get('mode') == mode), key=lambda pair: pair[0].stat().st_mtime)
            search_path, search = latest('search')
            denial_path, denial = latest('canary')
            def success(report):
                return (report.get('stopped') is True and report.get('nativeExitCode') == 0 and report.get('nativeStatus') == 'SUCCESS'
                        and report.get('numTurns') == 1 and report.get('agent') == 'cli-gateway-research' and report.get('permissionMode') == 'strict'
                        and report.get('diagnostics', {}).get('subagentStepCount') == 0)
            network_reports = []
            for path in data.glob('cli-egress-probe-*.json'):
                report = json.loads(read(path))
                if (report.get('egressDigest') == scope['egressDigest'] and path.stat().st_mtime >= earliest.timestamp()
                        and report.get('networkChecksPassed') is True and report.get('privateCanaryPositiveControl') is True
                        and len(report.get('tests', {})) == 15 and all(v is True for v in report['tests'].values())):
                    network_reports.append(path)
            network_path = max(network_reports, key=lambda path: path.stat().st_mtime)
            checks = {'nativeAccountVerified': success(search), 'agentSelected': success(search) and success(denial),
                      'networkChecksPassed': bool(network_path),
                      'webSearchVerified': search.get('parserVerified') is True and search.get('hasUnescoSource') is True
                        and any(s.get('name') == 'search_web' and s.get('state') == 'DONE' for s in search.get('toolSteps', [])),
                      'nativeReadDenied': denial.get('canaryLeaked') is False
                        and denial.get('diagnostics', {}).get('deniedToolStepCount', 0) > 0
                        and denial.get('diagnosticAgentDigest') == digest(AGENT.replace(b'tools: [search_web]', b'tools: [view_file]'))}
            if set(checks) != CHECKS or not all(checks.values()):
                raise ValueError('Fresh runtime verification did not pass')
            evidence = {**scope, **{key: candidate[key] for key in IDENTITY if key in candidate}, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': checks,
                        'customerReleaseApproved': False, 'previousManifestDigest': original_digest,
                        'sourceReports': [{'file': str(p), 'digest': digest(read(p))} for p in (search_path, denial_path, network_path)]}
            path = data / ('rebuild-evidence-' + digest(json.dumps(evidence, sort_keys=True).encode()) + '.json')
            with path.open('x') as output:
                path.chmod(0o600); json.dump(evidence, output, indent=2)
            updated = {**candidate, 'evidenceFile': str(path), 'evidenceDigest': digest(read(path))}
            personal_approval(updated)
            return updated

        updated = verify(candidate)
        encoded = json.dumps(updated, indent=2).encode()
        new_digest = digest(encoded)
        replacements = []
        for binding in bindings.values():
            account = {**updated, **{key: binding[key] for key in IDENTITY},
                'personalRuntimeRef': binding['personalRuntimeRef'], 'baseManifestDigest': new_digest}
            account = verify(account)
            path = Path(values['CLI_MANIFEST_DIR']) / 'accounts' / (account['accountConnectionId'] + '.json')
            replacements.append((path, json.dumps(account, indent=2).encode()))
        target = Path(values['CLI_MANIFEST_DIR']) / 'gemini-personal.json'
        before = read(target)
        if digest(before) != original_digest:
            raise ValueError('Original manifest changed during validation')
        backup = data / ('previous-personal-manifest-' + original_digest + '.backup')
        if not backup.exists():
            with backup.open('xb') as output:
                backup.chmod(0o600); output.write(before)
        replacements.append((target, encoded))
        # Validate every account before replacing any manifest. The host stays
        # drained throughout; an interrupted rotation fails closed on restart.
        staged = []
        for destination, content in replacements:
            previous = read(destination)
            saved = data / ('runtime-rotation-' + digest(previous) + '.backup')
            if not saved.exists():
                with saved.open('xb') as output: saved.chmod(0o600); output.write(previous)
            temporary = destination.with_suffix('.new')
            with temporary.open('xb') as output: temporary.chmod(0o600); output.write(content)
            staged.append((temporary, destination))
        for temporary, destination in staged: temporary.replace(destination)
        load_account_bindings(values['CLI_MANIFEST_DIR'], manifests(values['CLI_MANIFEST_DIR']))
        print(json.dumps({'manifestDigest': digest(read(target)), 'image': updated['image'], 'customerReleaseApproved': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Rebuilt runtime approval stopped. Keep the host drained and review fresh evidence.', flush=True)
        raise SystemExit(1) from None
