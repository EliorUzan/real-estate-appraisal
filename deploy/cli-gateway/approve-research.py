"""Rotate one drained personal manifest after real native search and denial checks.

Does not enable customer release, change accounts, or undrain the host.
The previous manifest is retained outside the active JSON manifest directory.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
from cli_gateway.client import Client
from cli_gateway.main import personal_approval, manifests
from cli_gateway.network import controls
from cli_gateway.recovery import Journal
from cli_gateway.runner import Docker
from cli_gateway.research import AGENT, POLICY, PROFILE, CHECKS


def private_file(value):
    path=Path(value)
    if not path.is_absolute() or not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('Private regular file required')
    return path


def digest(raw):return hashlib.sha256(raw).hexdigest()


def main():
    import fcntl
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    args=parser.parse_args()
    if os.environ.get('CODESPACES')!='true':raise ValueError('Personal Codespaces only')
    values=dict(line.split('=',1) for line in private_file(args.config).read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):os.environ['DOCKER_HOST']=values['DOCKER_HOST']
    data=Path(values['CLI_DATA_DIR'])
    target=private_file(str(Path(values['CLI_MANIFEST_DIR'])/'gemini-personal.json'))
    original=target.read_bytes(); entry=json.loads(original)
    if entry.get('capabilityProfile') or not personal_approval(entry):raise ValueError('Reviewed original personal runtime required')
    client=Client(values['CLI_WORKER_URL'],values['CLI_HOST_ID'],private_file(values['CLI_HOST_SECRET_FILE']).read_text().strip())
    with (data/'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        engine=Docker()
        if engine.inventory() or Journal(data/'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('Resolve outstanding attempts')
        if not client.call('heartbeatHost',manifests=[]).get('drain'):raise ValueError('Drain the host first')
        controls(engine,entry)
        if any(c['provider']=='gemini' and c['runtimeRef']==entry['personalRuntimeRef']
               for c in client.call('getMaintenance')['connections']):raise ValueError('Account needs maintenance')
        policy=json.dumps(POLICY,sort_keys=True).encode()
        scope={key:entry[key] for key in ('provider','cliRuntime','version','image','personalRuntimeRef','egressDigest','toolRegistryDigest')}
        scope.update(capabilityProfile=PROFILE,policyDigest=digest(policy),agentDigest=digest(AGENT))
        earliest=datetime.now(timezone.utc)-timedelta(hours=1)
        reports=[]
        for path in data.glob('research-probe-*.json'):
            report=json.loads(private_file(str(path)).read_text())
            if (all(report.get(key)==scope[key] for key in ('image','personalRuntimeRef','egressDigest','toolRegistryDigest','policyDigest','agentDigest'))
                and datetime.fromisoformat(report['checkedAt'])>=earliest):reports.append((path,report))
        def latest(mode):
            matches=[(p,r) for p,r in reports if r.get('mode')==mode]
            if not matches:raise ValueError('Missing fresh scoped evidence')
            return max(matches,key=lambda pair:pair[0].stat().st_mtime)
        search_path,search=latest('search'); denial_path,denial=latest('canary')
        def success(r):
            return (r.get('stopped') is True and r.get('nativeExitCode')==0 and r.get('nativeStatus')=='SUCCESS'
                and r.get('numTurns')==1 and r.get('agent')=='cli-gateway-research' and r.get('permissionMode')=='strict'
                and r.get('diagnostics',{}).get('subagentStepCount')==0)
        if not (success(search) and search.get('parserVerified') is True and search.get('hasUnescoSource') is True
                and any(s.get('name')=='search_web' and s.get('state')=='DONE' for s in search.get('toolSteps',[]))):
            raise ValueError('Actual web search did not pass')
        if not (success(denial) and denial.get('canaryLeaked') is False
                and denial.get('diagnosticAgentDigest')==digest(AGENT.replace(b'tools: [search_web]',b'tools: [view_file]'))
                and denial.get('diagnostics',{}).get('deniedToolStepCount',0)>0):raise ValueError('Native read denial did not pass')
        networks=[]
        for path in data.glob('cli-egress-probe-*.json'):
            report=json.loads(private_file(str(path)).read_text())
            if (report.get('egressDigest')==entry['egressDigest'] and report.get('networkChecksPassed') is True
                and report.get('privateCanaryPositiveControl') is True and len(report.get('tests',{}))==15
                and all(v is True for v in report['tests'].values()) and path.stat().st_mtime>=earliest.timestamp()):networks.append(path)
        if not networks:raise ValueError('Missing fresh network checks')
        network_path=max(networks,key=lambda p:p.stat().st_mtime)
        evidence={**scope,'checkedAt':datetime.now(timezone.utc).isoformat(),'checks':{key:True for key in CHECKS},
            'customerReleaseApproved':False,'previousManifestDigest':digest(original),
            'sourceReports':[{'file':str(p),'digest':digest(p.read_bytes())} for p in (search_path,denial_path,network_path)],
            'limitations':['Personal account experiment only; customer G1/G2 remain incomplete',
                'Search only: page reading and Maps MCP are not approved']}
        evidence_path=data/('research-evidence-'+digest(json.dumps(evidence,sort_keys=True).encode())+'.json')
        with evidence_path.open('x') as output:evidence_path.chmod(0o600);json.dump(evidence,output,indent=2)
        updated={**entry,**scope,'settingsFile':str((data/('research-settings-'+scope['policyDigest']+'.json')).resolve()),
            'agentFile':str((data/('research-agent-'+scope['agentDigest']+'.md')).resolve()),
            'evidenceFile':str(evidence_path),'evidenceDigest':digest(evidence_path.read_bytes())}
        if Path(updated['settingsFile']).read_bytes()!=policy or Path(updated['agentFile']).read_bytes()!=AGENT:
            raise ValueError('Capability inputs changed')
        personal_approval(updated)
        backup=data/('previous-personal-manifest-'+digest(original)+'.backup')
        if not backup.exists():
            with backup.open('xb') as output:backup.chmod(0o600);output.write(original)
        temporary=target.with_suffix('.new')
        with temporary.open('x') as output:temporary.chmod(0o600);json.dump(updated,output,indent=2)
        temporary.replace(target)
        if len(manifests(target.parent))!=1:raise ValueError('Manifest validation failed')
        print(json.dumps({'capabilityProfile':PROFILE,'manifestDigest':digest(target.read_bytes()),'customerReleaseApproved':False}))


if __name__=='__main__':
    try:main()
    except Exception:
        print('Search approval stopped. Keep the host drained and review sanitized evidence.',flush=True)
        raise SystemExit(1) from None
