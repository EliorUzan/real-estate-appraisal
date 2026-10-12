"""Operator-verified personal homes using an unchanged approved runtime.

These bindings never make an arbitrary user's home executable. Each extra home
has its own native-account/canary evidence; image, tools and egress must be equal
to the base approval. Database ownership checks remain the admission authority.
"""
import json
import re
from pathlib import Path
from .contracts import GatewayError

IDENTITY = {'baseManifestDigest', 'accountConnectionId', 'accountOwnerId', 'accountRevision'}
PER_ACCOUNT = IDENTITY | {'personalRuntimeRef', 'evidenceFile', 'evidenceDigest'}


def load_account_bindings(directory, approved):
    from .main import personal_approval
    folder = Path(directory) / 'accounts'
    if not folder.exists():
        return {}
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Private regular account directory required')
    bindings = {}
    for path in folder.glob('*.json'):
        if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
            raise ValueError('Private regular account binding required')
        entry = json.loads(path.read_bytes())
        base_digest = entry.get('baseManifestDigest')
        base = approved.get(base_digest)
        if not base or set(entry) != set(base) | IDENTITY:
            raise ValueError('Account binding belongs to a different runtime approval')
        if any(entry[key] != value for key, value in base.items() if key not in PER_ACCOUNT):
            raise ValueError('Account binding cannot change image, tools, network or release scope')
        for key in ('accountConnectionId', 'accountOwnerId'):
            import uuid
            if str(uuid.UUID(entry[key])) != entry[key]:
                raise ValueError('Explicit account identity required')
        if type(entry['accountRevision']) is not int or entry['accountRevision'] < 1:
            raise ValueError('Explicit account revision required')
        runtime = entry.get('personalRuntimeRef', '')
        if not re.fullmatch(r'cli-home-[0-9a-f-]{36}', runtime) or runtime == base.get('personalRuntimeRef'):
            raise ValueError('A separate private account home is required')
        if not personal_approval(entry):
            raise ValueError('Personal account verification required')
        evidence = json.loads(Path(entry['evidenceFile']).read_bytes())
        if any(evidence.get(key) != entry[key] for key in IDENTITY):
            raise ValueError('Verification evidence belongs to another account')
        key = (base_digest, runtime)
        if key in bindings:
            raise ValueError('Duplicate account home approval')
        bindings[key] = entry
    return bindings


def manifest_for_job(job, base, bindings):
    if base.get('executionHostMode') != 'codespaces-personal' or job.get('runtimeRef') == base.get('personalRuntimeRef'):
        return base
    entry = bindings.get((job.get('manifestDigest'), job.get('runtimeRef')))
    if not entry or entry['provider'] != job.get('provider'):
        raise GatewayError('PERSONAL_RUNTIME_SCOPE_REQUIRED')
    return entry
