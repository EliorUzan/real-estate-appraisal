"""Restore only an already-approved, credential-free personal relay."""
import json
import hashlib
from pathlib import Path
from urllib.parse import urlsplit

from .contracts import GatewayError
from .network import controls, regular_bytes


def file_digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore_image(engine, manifest, data):
    """Reload an exact approved image from a private source-only local backup."""
    image_id = manifest['image']
    try:
        engine.command(['image', 'inspect', image_id])
        return
    except GatewayError:
        pass
    # Retain the original Google backup; additional providers have separate
    # receipts so provisioning one provider never replaces another's recovery.
    stem = 'runtime-image' if manifest.get('provider', 'gemini') == 'gemini' else 'runtime-image-' + manifest['provider']
    if manifest.get('provider', 'gemini') not in ('gemini', 'claude'):
        raise ValueError('Unsupported personal provider backup')
    archive, receipt = Path(data) / (stem + '.tar'), Path(data) / (stem + '.json')
    for path in (archive, receipt):
        if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
            raise ValueError('Private approved runtime backup required')
    metadata = json.loads(receipt.read_text())
    if metadata.get('image') != image_id or metadata.get('sha256') != file_digest(archive):
        raise ValueError('Runtime backup differs from approved image')
    engine.command(['image', 'load', '--input', str(archive)], timeout=180)
    info = json.loads(engine.command(['image', 'inspect', image_id]))
    if len(info) != 1 or info[0].get('Id') != image_id:
        raise ValueError('Restored runtime identity mismatch')


def restore_relay(engine, manifest):
    # Caller must own supervisor.lock and have reconciled all native work.
    controls(engine, manifest, allow_stopped_relay=True)
    report = json.loads(regular_bytes(manifest['egressFile'], manifest['egressDigest']))
    name = report['proxyContainer']
    provider = manifest.get('provider', 'gemini')
    if provider not in ('gemini', 'claude') or name != 'cli-egress-' + provider or report['network'] != 'cli-provider-' + provider:
        raise ValueError('Only the reviewed personal relay can be restored')
    if engine.inspect(name).get('Running'):
        return
    try:
        engine.command(['start', name])
    except GatewayError as error:
        if error.code != 'ENGINE_LAYER_MISSING':
            raise
        # Codespaces may retain Docker container metadata after losing its
        # writable layer. The relay has no volumes or credentials: controls()
        # has verified both mounts are the immutable reviewed public files.
        controls(engine, manifest, allow_stopped_relay=True)
        if engine.inspect(name).get('Running') or engine.inventory():
            raise ValueError('Stopped empty runtime required for relay repair')
        # A different Docker storage driver can hide the approved image as well
        # as its layers. Leave the old metadata intact for operator recovery.
        image = json.loads(engine.command(['image', 'inspect', report['proxyImage']]))
        if len(image) != 1 or image[0].get('Id') != report['proxyImage']:
            raise ValueError('Approved relay image unavailable')
        engine.command(['rm', name])  # Never remove a native home or use -v/-f.
        bind = urlsplit(report['proxyUrl']).hostname
        engine.command(['create', '--name', name, '--label', 'appraisal.cli-egress=1',
                        '--restart', 'no', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
                        '--security-opt', 'no-new-privileges', '--cpus', '0.5', '--memory', '128m', '--pids-limit', '32',
                        '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1', '--log-opt', 'compress=false',
                        '--network', 'bridge', '--entrypoint', 'python3',
                        '--mount', 'type=bind,source=' + report['codeFile'] + ',target=/opt/egress.py,readonly',
                        '--mount', 'type=bind,source=' + report['policyFile'] + ',target=/opt/policy.json,readonly',
                        report['proxyImage'], '/opt/egress.py', '--policy', '/opt/policy.json', '--bind', bind])
        engine.command(['network', 'connect', '--ip', bind, report['network'], name])
        engine.command(['start', name])
    controls(engine, manifest)
