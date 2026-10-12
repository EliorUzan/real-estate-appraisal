import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from cli_gateway.personal_accounts import load_account_bindings, manifest_for_job
from cli_gateway.contracts import GatewayError
from cli_gateway.research import PROFILE, CHECKS


class AccountBindingsTests(unittest.TestCase):
    def test_original_and_second_home_are_separate_and_unknown_homes_fail(self):
        base = {'executionHostMode': 'codespaces-personal', 'personalRuntimeRef': 'first'}
        second = {'provider': 'gemini', 'personalRuntimeRef': 'second'}
        bindings = {('approved', 'second'): second}
        self.assertIs(manifest_for_job({'runtimeRef': 'first'}, base, bindings), base)
        self.assertIs(manifest_for_job({'runtimeRef': 'second', 'provider': 'gemini', 'manifestDigest': 'approved'}, base, bindings), second)
        for change in ({'runtimeRef': 'other'}, {'manifestDigest': 'unapproved'}, {'provider': 'openai'}):
            with self.assertRaises(GatewayError):
                manifest_for_job({'runtimeRef': 'second', 'provider': 'gemini', 'manifestDigest': 'approved', **change}, base, bindings)
        self.assertEqual(base['personalRuntimeRef'], 'first')

    @unittest.skipUnless(os.name == 'posix', 'Private file modes require Linux')
    def test_binding_requires_scoped_evidence_and_identical_runtime_controls(self):
        with tempfile.TemporaryDirectory() as root, patch.dict('os.environ', {'CODESPACES': 'true'}):
            folder = Path(root); (folder / 'accounts').mkdir()
            first = 'cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b'
            second = 'cli-home-9475e06d-727f-476a-8393-6b7c94036228'
            identity = dict(baseManifestDigest='a'*64, accountOwnerId='f0a39575-dc3d-42ed-baf9-e15201e41a18',
                accountConnectionId='bec2b376-b8c4-4986-a395-5b9d1509a95c', accountRevision=1)
            base = dict(provider='gemini', cliRuntime='antigravity', version='1.3.3', image='sha256:'+'b'*64,
                personalRuntimeRef=first, policyDigest='c'*64, agentDigest='d'*64, egressDigest='e'*64,
                toolRegistryDigest='f'*64, capabilityProfile=PROFILE, personalExperimentApproved=True,
                customerReleaseApproved=False, g1Passed=False, g2Passed=False, executionHostMode='codespaces-personal',
                evidenceFile='base-evidence', evidenceDigest='1'*64, network='cli-provider-gemini')
            evidence = {**base, **identity, 'personalRuntimeRef': second, 'checks': {key: True for key in CHECKS}}
            evidence_path = folder / 'evidence'; evidence_path.write_text(json.dumps(evidence)); evidence_path.chmod(0o600)
            entry = {**base, **identity, 'personalRuntimeRef': second, 'evidenceFile': str(evidence_path),
                'evidenceDigest': hashlib.sha256(evidence_path.read_bytes()).hexdigest()}
            target = folder / 'accounts' / 'account.json'
            def load(value):
                target.write_text(json.dumps(value)); target.chmod(0o600)
                return load_account_bindings(folder, {'a'*64: base})
            self.assertIn(('a'*64, second), load(entry))
            for changed in ({'image': 'sha256:'+'9'*64}, {'policyDigest': '9'*64}, {'customerReleaseApproved': True},
                {'baseManifestDigest': '9'*64}, {'accountRevision': 2}, {'personalRuntimeRef': first}):
                with self.assertRaises(ValueError): load({**entry, **changed})
