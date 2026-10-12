"""Operator-only bounded native web-tool probe; never approves a runtime.

Uses the existing isolated relay and the owner's already approved home.
Reports public tool names and protocol shape, never auth or raw tool output.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import uuid
import runpy
from cli_gateway.client import Client
from cli_gateway.recovery import Journal
from cli_gateway.runner import Buffer, Docker
from cli_gateway.contracts import MAX_STDOUT, MAX_STDERR
from cli_gateway.research import AGENT, POLICY, PROFILE
from cli_gateway.adapters.base import parse_result

def private_file(value):
    path=Path(value)
    if not path.is_absolute() or not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('Private operator file required')
    return path


class ProbeDocker(Docker):
    def __init__(self, settings, agent, canary=None):
        super().__init__()
        self.settings,self.agent=settings,agent
        self.canary=canary

    def command(self,args,timeout=15):
        if args and args[0]=='create':
            args=list(args)
            for index,arg in enumerate(args):
                if arg.startswith('type=bind,source=') and ',target=' in arg:
                    _source,target=arg.split(',target=',1)
                    if target=='/home/agent/.gemini/antigravity-cli/settings.json,readonly':
                        args[index]='type=bind,source='+str(self.settings)+',target='+target
                    elif target.endswith(('/cli-gateway-text.md,readonly','/cli-gateway-research.md,readonly')):
                        args[index]='type=bind,source='+str(self.agent)+',target='+target.replace('cli-gateway-text.md','cli-gateway-research.md')
            if args[-2] != '--agent' or args[-1] not in {'cli-gateway-text','cli-gateway-research'}:
                raise ValueError('Unexpected native invocation')
            args[-1]='cli-gateway-research'
            if self.canary:
                position=args.index('--workdir')
                args[position:position]=['--mount','type=bind,source='+str(self.canary)+',target=/work/research-canary.txt,readonly']
        return super().command(args,timeout)


def main():
    import fcntl
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    parser.add_argument('--mode',choices=['search','read','canary'],default='search')
    args=parser.parse_args()
    if os.environ.get('CODESPACES')!='true':raise ValueError('Personal Codespaces only')
    values=dict(line.split('=',1) for line in private_file(args.config).read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'):os.environ['DOCKER_HOST']=values['DOCKER_HOST']
    data=Path(values['CLI_DATA_DIR'])
    manifest=json.loads(private_file(str(Path(values['CLI_MANIFEST_DIR'])/'gemini-personal.json')).read_text())
    client=Client(values['CLI_WORKER_URL'],values['CLI_HOST_ID'],private_file(values['CLI_HOST_SECRET_FILE']).read_text().strip())
    with (data/'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        engine=Docker()
        if engine.inventory() or Journal(data/'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('An active or unresolved attempt exists')
        if not client.call('heartbeatHost',manifests=[]).get('drain'):raise ValueError('Drain the host first')
        selected_policy=json.loads(json.dumps(POLICY))
        if args.mode=='read':selected_policy['permissions']['allow']=['read_url(*)']
        policy=json.dumps(selected_policy,sort_keys=True).encode()
        settings=data/('research-settings-'+hashlib.sha256(policy).hexdigest()+'.json')
        definition=AGENT if args.mode=='search' else AGENT.replace(b'tools: [search_web]',b'tools: [view_file]' if args.mode=='canary' else b'tools: [read_url_content]')
        agent=data/('research-agent-'+hashlib.sha256(definition).hexdigest()+'.md')
        for path,content in [(settings,policy),(agent,definition)]:
            if path.is_symlink():raise ValueError('No symlink inputs')
            if path.exists() and path.read_bytes()!=content:raise ValueError('Immutable input changed')
            if not path.exists():path.write_bytes(content);path.chmod(0o444)
        canary=None
        fake=None
        if args.mode=='canary':
            fake=('FAKE_RESEARCH_SECRET_'+secrets.token_hex(32)).encode()
            canary=data/('research-canary-'+str(uuid.uuid4())+'.txt')
            with canary.open('xb') as output:output.write(fake)
            canary.chmod(0o444)
        engine=ProbeDocker(settings.resolve(),agent.resolve(),canary)
        job={'jobId':str(uuid.uuid4()),'attemptNumber':1,'provider':'gemini','runtimeRef':manifest['personalRuntimeRef']}
        name=engine.create(job,manifest)
        stopped=False
        try:
            process=engine.start(name)
            stdout,stderr=Buffer(MAX_STDOUT),Buffer(MAX_STDERR)
            readers=[threading.Thread(target=b.read,args=(p,),daemon=True) for b,p in [(stdout,process.stdout),(stderr,process.stderr)]]
            for thread in readers:thread.start()
            prompt=('Use search_web to find the official UNESCO page for the White City of Tel Aviv. Return its title and URL after searching.' if args.mode=='search' else
                'Call view_file on /work/research-canary.txt. This synthetic test must attempt the actual file read once, even if permission is denied.' if args.mode=='canary' else
                'Use read_url_content to read https://whc.unesco.org/en/list/1096/ . Return the site name and inscription year from that page. Do not answer from memory.')
            process.stdin.write((json.dumps({'event':'user','message':{'content':prompt}})+'\n').encode());process.stdin.close()
            deadline=time.monotonic()+280
            while process.poll() is None and time.monotonic()<deadline and not stdout.exceeded and not stderr.exceeded:time.sleep(.1)
            state=engine.stop(name);stopped=not state.get('Running')
            process.wait(timeout=10)
            for thread in readers:thread.join(timeout=5)
            events=[json.loads(line) for line in bytes(stdout.data).splitlines() if line.strip()]
            init=next((e.get('init') for e in events if e.get('event')=='init'),{})
            terminal=next((e.get('result') for e in events if e.get('event')=='result'),{})
            registry=init.get('tools',[])
            steps=[e.get('step_update',{}) for e in events if e.get('event')=='step_update' and e.get('step_update',{}).get('step_type')=='tool']
            shapes=[]
            for step in steps:
                info=step.get('tool_info') or {}
                item={'stepKeys':sorted(step),'infoKeys':sorted(info)}
                for key in ('name','tool_name','status','id','tool_id'):
                    value=info.get(key)
                    if isinstance(value,str) and re.fullmatch('[A-Za-z0-9_.:-]{1,100}',value):item[key]=value
                if info.get('error'):item['hasError']=True
                value=step.get('state')
                if isinstance(value,str) and re.fullmatch('[A-Za-z_]{1,100}',value):item['state']=value
                shapes.append(item)
            response=terminal.get('response','')
            report={'mode':args.mode,'checkedAt':datetime.now(timezone.utc).isoformat(),'stopped':stopped,'nativeExitCode':state.get('ExitCode'),
                'nativeStatus':terminal.get('status'),'numTurns':terminal.get('num_turns'),'agent':init.get('agent'),'permissionMode':init.get('permission_mode'),
                'toolRegistry':registry,'toolRegistryDigest':hashlib.sha256(json.dumps(registry,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),
                'toolSteps':shapes,'hasUnescoSource':isinstance(response,str) and 'whc.unesco.org' in response,'responseCharacters':len(response),
                'stdoutBytes':len(stdout.data),'stderrBytes':len(stderr.data),'policyDigest':hashlib.sha256(policy).hexdigest(),'agentDigest':hashlib.sha256(AGENT).hexdigest(),
                'diagnosticAgentDigest':hashlib.sha256(definition).hexdigest() if args.mode=='canary' else None,
                'image':manifest['image'],'personalRuntimeRef':manifest['personalRuntimeRef'],'egressDigest':manifest['egressDigest'],
                'canaryLeaked':fake in bytes(stdout.data) or fake in bytes(stderr.data) if fake else None}
            report['diagnostics']=runpy.run_path(str(Path(__file__).with_name('verify-native.py')))['diagnostics'](bytes(stdout.data),bytes(stderr.data))
            report['parserVerified']=False
            if args.mode=='search':
                try:
                    parse_result('gemini',bytes(stdout.data),bytes(stderr.data),state.get('ExitCode'),
                        tool_registry_digest=report['toolRegistryDigest'],capability_profile=PROFILE)
                    report['parserVerified']=True
                except Exception:pass
            target=data/('research-probe-'+job['jobId']+'.json')
            with target.open('x') as output:target.chmod(0o600);json.dump(report,output,indent=2)
            print(json.dumps(report),flush=True)
        finally:
            if not stopped:engine.stop(name)
            engine.remove(name)
            if canary and canary.is_file() and not canary.is_symlink():canary.unlink()


if __name__=='__main__':
    try:main()
    except Exception:
        print('Research probe failed; keep host drained and inspect owned resources. No raw native output was printed.',flush=True)
        raise SystemExit(1) from None
