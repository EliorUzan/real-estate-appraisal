import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


path = Path(__file__).resolve().parents[2] / 'deploy/cli-gateway/install-codespace-startup.py'
spec = importlib.util.spec_from_file_location('codespace_installer', path)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


@unittest.skipUnless(os.name == 'posix', 'Executes the real POSIX startup shell')
class CodespaceStartupTests(unittest.TestCase):
    def run_hook(self, uid, docker_ready=True):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def executable(name, body):
                p = root / name
                p.write_text('#!/bin/sh\n' + body + '\n')
                p.chmod(0o700)
                return str(p)
            trace = root / 'trace'
            fake_id = executable('id', 'echo ' + str(uid))
            docker = executable('docker', 'exit ' + ('0' if docker_ready else '1'))
            vendor = executable('vendor', 'echo vendor >> "$TRACE"')
            hook = executable('hook', 'echo worker:$CODESPACES >> "$TRACE"')
            # Check the exact unprivileged target, then execute the supplied argv.
            runuser = executable('runuser', '[ "$1 $2 $3" = "-u codespace --" ] || exit 19\necho drop-user >> "$TRACE"\nshift 3\nexec "$@"')
            script = installer.startup_script('codespace', 1000, hook, vendor)
            script = script.replace('/usr/bin/id', fake_id).replace('/usr/bin/docker', docker).replace('/usr/sbin/runuser', runuser)
            result = subprocess.run(['/bin/sh', '-c', script], env={**os.environ, 'TRACE': str(trace)}, capture_output=True, text=True, timeout=5)
            return result.returncode, trace.read_text().splitlines() if trace.exists() else []

    def test_native_container_user_starts_without_runuser(self):
        self.assertEqual(self.run_hook(1000), (0, ['worker:true']))

    def test_root_drops_privileges_after_initializing_docker(self):
        self.assertEqual(self.run_hook(0, docker_ready=False), (0, ['vendor', 'drop-user', 'worker:true']))

    def test_unexpected_user_cannot_launch_worker(self):
        self.assertEqual(self.run_hook(1001), (1, []))
