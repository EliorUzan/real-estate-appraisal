"""Install the personal worker hook on an existing Codespace without rebuilding.

Preserves the vendor Docker initializer and invokes it when Docker is not ready.
The supervisor always runs as the current unprivileged Codespace user.
New deployments should use the normal devcontainer postStartCommand instead.
"""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile


def startup_script(user, uid, hook, backup):
    """The Codespaces container entrypoint may already run as the native user."""
    command = '/usr/bin/env CODESPACES=true /bin/bash ' + shlex.quote(str(hook))
    return ('#!/bin/sh\n# appraisal-cli-gateway-startup-v2\n'
            + 'if ! /usr/bin/timeout 10 /usr/bin/docker --host unix:///var/run/docker.sock info >/dev/null 2>&1; then\n'
            + '  ' + shlex.quote(str(backup)) + ' "$@" || exit $?\nfi\n'
            + 'if [ "$#" -ne 0 ]; then exec "$@"; fi\n'
            + 'task_uid=$(/usr/bin/id -u)\n'
            + 'if [ "$task_uid" -eq 0 ]; then\n'
            + '  exec /usr/sbin/runuser -u ' + shlex.quote(user) + ' -- ' + command + '\n'
            + 'elif [ "$task_uid" -eq ' + str(uid) + ' ]; then\n'
            + '  exec ' + command + '\n'
            + 'else\n  echo "Unexpected startup user; worker not launched." >&2\n  exit 1\nfi\n')


def main():
    import pwd
    if os.environ.get('CODESPACES') != 'true' or os.getuid() == 0:
        raise ValueError('Run as the personal Codespace user')
    root = Path(__file__).resolve().parents[2]
    hook = root / 'deploy/cli-gateway/codespace-post-start.sh'
    initializer = Path('/usr/local/share/docker-init.sh')
    backup = Path('/usr/local/share/docker-init.cli-gateway-original.sh')
    if initializer.is_symlink() or not initializer.is_file() or not hook.is_file():
        raise ValueError('Expected existing initializer and startup hook')
    entrypoint = Path('/proc/1/cmdline').read_bytes()
    if b'/usr/local/share/docker-init.sh' not in entrypoint:
        raise ValueError('Current container does not use the reviewed entrypoint')
    user = pwd.getpwuid(os.getuid()).pw_name
    legacy_body = ('#!/bin/sh\n# appraisal-cli-gateway-startup-v1\n'
            + shlex.quote(str(backup)) + ' "$@"\n'
            + 'task_result=$?\n[ "$task_result" -eq 0 ] || exit "$task_result"\n'
            + 'if [ "$#" -eq 0 ]; then\n'
            + '  /usr/sbin/runuser -u ' + shlex.quote(user)
            + ' -- /usr/bin/env CODESPACES=true /bin/bash ' + shlex.quote(str(hook)) + '\nfi\n')
    # The vendor initializer is not idempotent when Docker is already running.
    # Probe the exact personal engine before invoking it (never change firewall
    # alternatives or launch a second containerd merely to start the worker).
    warm_body = legacy_body.replace(
        shlex.quote(str(backup)) + ' "$@"\ntask_result=$?\n[ "$task_result" -eq 0 ] || exit "$task_result"\n',
        'if ! /usr/bin/timeout 10 /usr/bin/docker --host unix:///var/run/docker.sock info >/dev/null 2>&1; then\n'
        + '  ' + shlex.quote(str(backup)) + ' "$@" || exit $?\nfi\n')
    body = startup_script(user, os.getuid(), hook, backup)
    if backup.exists():
        current = initializer.read_text()
        if current not in (body, legacy_body, warm_body) or backup.is_symlink():
            raise ValueError('Existing initializer changed; operator review required')
        if current == body:
            print('Existing startup hook matches; no changes.')
            return
    else:
        original = initializer.read_bytes()
        if b'appraisal-cli-gateway-startup' in original or b'containerd' not in original or b'exec "$@"' not in original:
            raise ValueError('Unexpected vendor initializer')
        subprocess.run(['sudo', '-n', '/usr/bin/install', '-o', 'root', '-g', 'root', '-m', '0755', str(initializer), str(backup)], check=True)
    # install uses fixed destinations. Preserve original contents before replacing
    # the entrypoint; never rebuild the container or modify a credential volume.
    with tempfile.TemporaryDirectory(prefix='cli-startup-') as temporary:
        candidate = Path(temporary) / 'docker-init.sh'
        candidate.write_text(body)
        subprocess.run(['/bin/sh', '-n', str(candidate)], check=True)
        subprocess.run(['sudo', '-n', '/usr/bin/install', '-o', 'root', '-g', 'root', '-m', '0755', str(candidate), str(initializer)], check=True)
    print('Startup hook installed; headless stop/start verification still required.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Startup installation stopped; operator review required.', flush=True)
        raise SystemExit(1) from None
