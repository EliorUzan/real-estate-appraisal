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
from cli_gateway.claude import MAPS_PROFILE, MAPS_POLICY, MAPS_CHECKS, MAPS_TOOLS, maps_config


class ClaudeTests(unittest.TestCase):
    def test_failure_diagnostics_retain_categories_without_native_text(self):
        from cli_gateway.adapters.base import claude_diagnostics
        secret = 'private-response-and-token'
        final = dict(type='result', subtype='error_during_execution', is_error=True,
                     num_turns=1, errors=['You have hit your limit: '+secret], session_id=secret)
        diagnostic = claude_diagnostics(json.dumps(final).encode())
        self.assertEqual(diagnostic, dict(terminalSubtype='error_during_execution', nativeError=True,
                                         nativeErrorTags=['quota'], turns=1))
        self.assertNotIn(secret, json.dumps(diagnostic))
        final.update(subtype=secret, num_turns=secret, errors=[secret])
        self.assertEqual(claude_diagnostics(json.dumps(final))['terminalSubtype'], 'unknown')
        self.assertIsNone(claude_diagnostics(json.dumps(final))['turns'])
        for value in [b'invalid', b'[]', b'null', b'\xff']:
            self.assertEqual(claude_diagnostics(value)['nativeErrorTags'], [])
        final.update(subtype='success', is_error=False, result='usage limit', errors=[])
        self.assertEqual(claude_diagnostics(json.dumps(final))['nativeErrorTags'], [])

    def test_maps_profile_preserves_login_and_restricts_tools(self):
        from cli_gateway.adapters.base import invocation
        args = invocation('claude', capability_profile=MAPS_PROFILE, model_selection='claude-sonnet-5-5')
        self.assertEqual(args[-4:], ['--model', 'claude-sonnet-5-5', '--effort', 'medium'])
        self.assertEqual(args[args.index('--allowedTools')+1].split(','), ['WebSearch', *MAPS_TOOLS])
        self.assertNotIn('mcp__*', args[args.index('--disallowedTools')+1])
        self.assertEqual(args[args.index('--mcp-config')+1], '/opt/gateway/claude-maps.json')
        self.assertIn('--strict-mcp-config', args)
        self.assertNotIn('--bare', args)
        self.assertIn('Bash', MAPS_POLICY['permissions']['deny'])

    def test_maps_approval_requires_actual_lookup_evidence_and_bound_config(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'CODESPACES':'true'}):
            evidence = Path(folder).resolve() / 'evidence.json'
            scope = dict(provider='claude',cliRuntime='claude-code',version=VERSION,image='sha256:'+'a'*64,
                personalRuntimeRef='cli-home-account-one',policyDigest='p',egressDigest='e',
                mapsConfigDigest='m',capabilityProfile=MAPS_PROFILE)
            entry = {**scope,'evidenceFile':str(evidence),'executionHostMode':'codespaces-personal',
                'personalExperimentApproved':True,'customerReleaseApproved':False,'g1Passed':False,'g2Passed':False}
            for checks, passes in [(CHECKS, False),(MAPS_CHECKS, True)]:
                evidence.write_text(json.dumps({**scope,'checks':dict.fromkeys(checks,True),'customerReleaseApproved':False}))
                entry['evidenceDigest'] = hashlib.sha256(evidence.read_bytes()).hexdigest()
                if passes: self.assertTrue(personal_approval(entry))
                else:
                    with self.assertRaises(ValueError): personal_approval(entry)
            with self.assertRaises(ValueError): personal_approval({**entry,'mapsConfigDigest':'other-key'})

    def test_maps_config_exact_endpoint_and_no_key_in_process_arguments(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'CODESPACES':'true'}):
            root = Path(folder).resolve()
            policy, config = root / 'policy.json', root / 'maps.json'
            key = 'AIza' + 'x'*35
            policy.write_text(json.dumps(MAPS_POLICY))
            config.write_text(json.dumps(maps_config(key))); config.chmod(0o600)
            home='cli-home-11111111-1111-4111-8111-111111111111'
            manifest=dict(provider='claude',cliRuntime='claude-code',capabilityProfile=MAPS_PROFILE,
                executionHostMode='codespaces-personal',customerReleaseApproved=False,personalRuntimeRef=home,
                image='sha256:'+'a'*64,network='none',settingsFile=str(policy),policyDigest=hashlib.sha256(policy.read_bytes()).hexdigest(),
                mapsConfigFile=str(config),mapsConfigDigest=hashlib.sha256(config.read_bytes()).hexdigest())
            job=dict(jobId='22222222-2222-4222-8222-222222222222',attemptNumber=1,provider='claude',runtimeRef=home)
            # Windows chmod does not implement Unix group/other bits.
            with patch.object(Docker,'command') as command, patch('cli_gateway.runner.maps_private_file', return_value=True):
                Docker().create(job,manifest)
                args=command.call_args.args[0]
                self.assertNotIn(key, ' '.join(args))
                self.assertIn('type=bind,source='+str(config)+',target=/opt/gateway/claude-maps.json,readonly',args)
                config.write_text('{}')
                with self.assertRaises(ValueError): Docker().create(job,manifest)
                bad=maps_config(key); bad['mcpServers']['google_maps']['url']='https://example.com/mcp'
                config.write_text(json.dumps(bad)); manifest['mapsConfigDigest']=hashlib.sha256(config.read_bytes()).hexdigest()
                with self.assertRaises(ValueError): Docker().create(job,manifest)

    def test_explicit_models_and_effort_reach_invocation(self):
        from cli_gateway.adapters.base import invocation
        from cli_gateway.contracts import GatewayError
        for name, effort in [('claude-opus-5-5', 'high'), ('claude-sonnet-5-5', 'medium'), ('claude-haiku-5-5', 'low')]:
            args = invocation('claude', capability_profile=PROFILE, model_selection=name)
            self.assertEqual(args[-4:], ['--model', name, '--effort', effort])
            self.assertIn('dontAsk', args)
            with self.assertRaises(GatewayError): invocation('gemini', model_selection=name)
        self.assertNotIn('--model', invocation('claude', capability_profile=PROFILE))
        for value in ['--model bad', None, {}, 'opus', 'claude-opus-5-5;echo bad']:
            with self.assertRaises(GatewayError): invocation('claude', model_selection=value)

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
