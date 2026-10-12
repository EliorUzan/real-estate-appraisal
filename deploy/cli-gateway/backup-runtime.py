"""Save the approved immutable image, never its native credential volumes."""
import argparse
import json
import os
from pathlib import Path
from cli_gateway.main import manifests
from cli_gateway.runner import Docker
from cli_gateway.startup import file_digest


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    path = Path(args.config)
    if os.environ.get('CODESPACES') != 'true' or not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private Codespaces configuration required')
    values = dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):
        os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    entries = manifests(values['CLI_MANIFEST_DIR'])
    if len(entries) != 1:
        raise ValueError('One reviewed personal runtime required')
    entry = next(iter(entries.values()))
    data = Path(values['CLI_DATA_DIR'])
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        engine = Docker()
        if engine.inventory():
            raise ValueError('Native work must be stopped before backup')
        temporary = data / 'runtime-image.tar.new'
        # Exclusive creation avoids following an old symlink or replacing a
        # previous interrupted backup without operator inspection.
        with temporary.open('xb'):
            temporary.chmod(0o600)
        engine.command(['image', 'save', '--output', str(temporary), entry['image']], timeout=300)
        receipt = data / 'runtime-image.json.new'
        with receipt.open('x') as stream:
            receipt.chmod(0o600)
            json.dump({'image': entry['image'], 'sha256': file_digest(temporary)}, stream)
        temporary.replace(data / 'runtime-image.tar')
        receipt.replace(data / 'runtime-image.json')
    print('Approved image backed up; no native credentials included.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Runtime backup failed. Existing credentials and approvals retained.', flush=True)
        raise SystemExit(1) from None
