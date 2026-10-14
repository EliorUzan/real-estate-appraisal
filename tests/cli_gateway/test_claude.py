import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cli_gateway.claude import PROFILE, VERSION, POLICY, CHECKS, arguments
from cli_gateway.main import personal_approval
from cli_gateway.runner import Docker


class ClaudeTests(unittest.TestCase):
    def test_native_account_is_kept_and_tools_are_explicit(self):
        args = arguments()
        self.assertNotIn('--bare', args)  # Bare disables subscription OAuth.
        self.assertNotIn('--dangerously-skip-permissions', args)
        self.assertEqual(args[args.index('--tools')+1], 'WebSearch')
        self.assertEqual(args[args.index('--permission-mode')+1], 'dontAsk')
        self.assertEqual(json.loads(args[args.index('--mcp-config')+1]), {'mcpServers':{}})

    def test_approval_is_bound_to_account_release_and_policy(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'CODESPACES':'true'}):
            evidence = Path(folder).resolve() / 'evidence.json'
            scope = dict(provider='claude', cliRuntime='claude-code', version=VERSION, image='sha256:'+'a'*64,
                         personalRuntimeRef='cli-home-account-one', policyDigest='p', egressDigest='e', capabilityProfile=PROFILE)
            evidence.write_text(json.dumps({**scope,'checks':dict.fromkeys(CHECKS,True),'customerReleaseApproved':False}))
            entry = {**scope,'evidenceFile':str(evidence),'evidenceDigest':hashlib.sha256(evidence.read_bytes()).hexdigest(),
                     'executionHostMode':'codespaces-personal','personalExperimentApproved':True,
                     'customerReleaseApproved':False,'g1Passed':False,'g2Passed':False}
            self.assertTrue(personal_approval(entry))
            for change in ({'personalRuntimeRef':'another-account'},{'version':'future'},{'policyDigest':'changed'},
                           {'provider':'gemini'},{'customerReleaseApproved':True}):
                with self.assertRaises(ValueError): personal_approval({**entry,**change})

    def test_runtime_mounts_exact_policy_and_no_workspace_source(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'CODESPACES':'true'}):
            path = Path(folder).resolve() / 'policy.json'
            path.write_text(json.dumps(POLICY))
            home = 'cli-home-11111111-1111-4111-8111-111111111111'
            manifest = dict(provider='claude', cliRuntime='claude-code', capabilityProfile=PROFILE,
                            executionHostMode='codespaces-personal',customerReleaseApproved=False,
                            personalRuntimeRef=home, image='sha256:'+'a'*64, network='none',
                            settingsFile=str(path),policyDigest=hashlib.sha256(path.read_bytes()).hexdigest())
            job=dict(jobId='22222222-2222-4222-8222-222222222222',attemptNumber=1,provider='claude',runtimeRef=home)
            with patch.object(Docker,'command') as command:
                Docker().create(job,manifest)
                args=command.call_args.args[0]
                self.assertIn('type=volume,source='+home+',target=/home/agent',args)
                self.assertIn('ENABLE_CLAUDEAI_MCP_SERVERS=false',args)
                self.assertIn('type=bind,source='+str(path)+',target=/opt/gateway/claude-research-settings.json,readonly',args)
                with self.assertRaises(ValueError): Docker().create({**job,'provider':'gemini'},manifest)
                path.write_text('{}')
                with self.assertRaises(ValueError): Docker().create(job,manifest)
