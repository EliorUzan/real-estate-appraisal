"""A rebuild must verify every owned account before replacing any approval."""
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from cli_gateway.research import AGENT, PROFILE


@unittest.skipUnless(os.name == 'posix', 'Operator rotation uses Linux locks and permissions')
class RuntimeRotationTests(unittest.TestCase):
    def test_missing_second_account_evidence_preserves_both_manifests(self):
        self.rotate(False)

    def test_verified_rotation_preserves_identity_and_updates_both_manifests(self):
        self.rotate(True)

    def rotate(self, second_verified):
        def sha(raw): return hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); data=root/'runtime'; data.mkdir()
            manifests=root/'manifests'; manifests.mkdir(); (manifests/'accounts').mkdir()
            def write(path, value):
                path.write_text(json.dumps(value)); path.chmod(0o600); return path
            base=dict(provider='gemini',cliRuntime='antigravity',version='1.3.3',image='old',personalRuntimeRef='first',
                policyDigest='policy',agentDigest='agent',egressDigest='network',toolRegistryDigest='registry',capabilityProfile=PROFILE,
                evidenceFile='old-evidence',evidenceDigest='old-digest')
            base_path=write(manifests/'gemini-personal.json',base); old_digest=sha(base_path.read_bytes())
            identity=dict(accountConnectionId='second-connection',accountOwnerId='second-owner',accountRevision=1,baseManifestDigest=old_digest)
            binding={**base,**identity,'personalRuntimeRef':'second'}
            account_path=write(manifests/'accounts/second-connection.json',binding)
            before=[p.read_bytes() for p in (base_path,account_path)]
            candidate=write(root/'candidate.json',{**base,'image':'new'})
            secret=root/'secret'; secret.write_text('synthetic');secret.chmod(0o600)
            config=root/'config';config.write_text('\n'.join(f'{k}={v}' for k,v in dict(CLI_MANIFEST_DIR=manifests,CLI_DATA_DIR=data,CLI_WORKER_URL='synthetic',CLI_HOST_ID='host',CLI_HOST_SECRET_FILE=secret).items()));config.chmod(0o600)
            for home in (['first','second'] if second_verified else ['first']):
                for mode in ('search','canary'):
                    report={**base,'image':'new','personalRuntimeRef':home,'mode':mode,'checkedAt':datetime.now(timezone.utc).isoformat(),
                        'stopped':True,'nativeExitCode':0,'nativeStatus':'SUCCESS','numTurns':1,'agent':'cli-gateway-research','permissionMode':'strict',
                        'diagnostics':{'subagentStepCount':0,'deniedToolStepCount':1},'parserVerified':True,'hasUnescoSource':True,
                        'toolSteps':[{'name':'search_web','state':'DONE'}],'canaryLeaked':False,
                        'diagnosticAgentDigest':sha(AGENT.replace(b'tools: [search_web]',b'tools: [view_file]'))}
                    if home=='second':report.update(connectionId='second-connection',revision=1)
                    write(data/f'research-probe-{home}-{mode}.json',report)
            write(data/'cli-egress-probe-test.json',dict(egressDigest='network',networkChecksPassed=True,privateCanaryPositiveControl=True,tests={str(i):True for i in range(15)}))
            main=runpy.run_path(str(Path(__file__).resolve().parents[2]/'deploy/cli-gateway/approve-rebuilt-runtime.py'))['main']
            client=Mock();client.call.side_effect=lambda action,**kw: {'drain':True} if action=='heartbeatHost' else {'job':None}
            engine=Mock();engine.inventory.return_value=[]
            journal=Mock();journal.load.return_value=None
            with patch.dict(os.environ,{'CODESPACES':'true'}), patch('sys.argv',['approve','--config',str(config),'--candidate',str(candidate)]), redirect_stdout(io.StringIO()), patch.dict(main.__globals__,{
                'manifests':lambda _: {old_digest:base},'load_account_bindings':lambda *_: {('base','second'):binding},
                'Client':lambda *_:client,'Docker':lambda:engine,'Journal':lambda _:journal,'controls':lambda *_:None,'personal_approval':lambda _:True}):
                if not second_verified:
                    with self.assertRaises(ValueError): main()
                    self.assertEqual(before,[p.read_bytes() for p in (base_path,account_path)])
                    return
                main()
            rotated=json.loads(base_path.read_bytes()); account=json.loads(account_path.read_bytes())
            self.assertEqual(rotated['image'],'new'); self.assertEqual(account['image'],'new')
            self.assertEqual(account['personalRuntimeRef'],'second')
            self.assertEqual(account['accountOwnerId'],'second-owner')
            self.assertEqual(account['baseManifestDigest'],sha(base_path.read_bytes()))
            evidence=json.loads(Path(account['evidenceFile']).read_bytes())
            self.assertEqual(evidence['accountConnectionId'],'second-connection')
            self.assertEqual(evidence['baseManifestDigest'],account['baseManifestDigest'])
