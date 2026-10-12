import json
import subprocess
import unittest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from cli_gateway.contracts import GatewayError
from cli_gateway.runner import Docker
from cli_gateway.startup import file_digest, restore_image, restore_relay


class StartupTests(unittest.TestCase):
    def test_image_restore_checks_receipt_before_loading(self):
        image_id = 'sha256:' + 'a' * 64
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / 'runtime-image.tar'
            receipt = Path(folder) / 'runtime-image.json'
            archive.write_bytes(b'source-only-image'); archive.chmod(0o600)
            receipt.write_text(json.dumps({'image': image_id, 'sha256': file_digest(archive)})); receipt.chmod(0o600)
            engine = Mock()
            engine.command.side_effect = [GatewayError('ENGINE_FAILED'), b'', json.dumps([{'Id': image_id}]).encode()]
            # Windows does not expose POSIX private modes; exercise the content
            # contract here while Linux performs the real permission check.
            import os
            if os.name == 'nt':
                self.skipTest('Private archive modes require Linux')
            restore_image(engine, {'image': image_id}, folder)
            self.assertEqual(engine.command.call_args_list[1].args[0][:2], ['image', 'load'])
            archive.write_bytes(b'changed')
            engine.reset_mock(); engine.command.side_effect = GatewayError('ENGINE_FAILED')
            with self.assertRaises(ValueError):
                restore_image(engine, {'image': image_id}, folder)
            self.assertEqual(engine.command.call_count, 1)

    def test_only_exact_relay_layer_failure_is_classified(self):
        result = subprocess.CompletedProcess([], 1, b'', b'Error: RWLayer of container abc is unexpectedly nil')
        with patch('cli_gateway.runner.subprocess.run', return_value=result):
            for args, code in [(['start', 'cli-egress-gemini'], 'ENGINE_LAYER_MISSING'),
                               (['start', 'cli-job-other'], 'ENGINE_FAILED')]:
                with self.assertRaises(GatewayError) as caught:
                    Docker().command(args)
                self.assertEqual(caught.exception.code, code)

    def restore(self, error):
        engine = Mock()
        engine.inspect.return_value = {'Running': False}
        engine.inventory.return_value = []
        engine.command.side_effect = [GatewayError(error), json.dumps([{'Id': 'sha256:' + 'a' * 64}]).encode(), b'', b'', b'', b'']
        report = dict(proxyContainer='cli-egress-gemini', network='cli-provider-gemini',
                      proxyUrl='http://172.19.0.2:8888', codeFile='/private/egress.py',
                      policyFile='/private/policy.json', proxyImage='sha256:' + 'a' * 64)
        return engine, report

    def test_missing_layer_recreates_only_credential_free_relay(self):
        engine, report = self.restore('ENGINE_LAYER_MISSING')
        with patch('cli_gateway.startup.controls') as controls, patch('cli_gateway.startup.regular_bytes', return_value=json.dumps(report)):
            restore_relay(engine, {'egressFile': '/private/report', 'egressDigest': 'digest'})
        calls = [c.args[0] for c in engine.command.call_args_list]
        self.assertEqual(calls[2], ['rm', 'cli-egress-gemini'])
        self.assertEqual(calls[-2], ['network', 'connect', '--ip', '172.19.0.2', 'cli-provider-gemini', 'cli-egress-gemini'])
        self.assertEqual(calls[-1], ['start', 'cli-egress-gemini'])
        self.assertNotIn('--volume', calls[3])
        self.assertIn('--read-only', calls[3])
        self.assertEqual(controls.call_count, 3)

    def test_other_engine_failure_does_not_remove_anything(self):
        engine, report = self.restore('ENGINE_FAILED')
        with patch('cli_gateway.startup.controls'), patch('cli_gateway.startup.regular_bytes', return_value=json.dumps(report)):
            with self.assertRaises(GatewayError):
                restore_relay(engine, {'egressFile': '/private/report', 'egressDigest': 'digest'})
        self.assertEqual(engine.command.call_count, 1)

    def test_changed_controls_prevent_removal(self):
        engine, report = self.restore('ENGINE_LAYER_MISSING')
        with patch('cli_gateway.startup.controls', side_effect=[None, ValueError('changed')]), patch('cli_gateway.startup.regular_bytes', return_value=json.dumps(report)):
            with self.assertRaises(ValueError):
                restore_relay(engine, {'egressFile': '/private/report', 'egressDigest': 'digest'})
        self.assertEqual(engine.command.call_count, 1)

    def test_missing_image_preserves_container_metadata(self):
        engine, report = self.restore('ENGINE_LAYER_MISSING')
        engine.command.side_effect = [GatewayError('ENGINE_LAYER_MISSING'), GatewayError('ENGINE_FAILED')]
        with patch('cli_gateway.startup.controls'), patch('cli_gateway.startup.regular_bytes', return_value=json.dumps(report)):
            with self.assertRaises(GatewayError):
                restore_relay(engine, {'egressFile': '/private/report', 'egressDigest': 'digest'})
        self.assertEqual(engine.command.call_count, 2)
        self.assertFalse(any(c.args[0][0] == 'rm' for c in engine.command.call_args_list))
