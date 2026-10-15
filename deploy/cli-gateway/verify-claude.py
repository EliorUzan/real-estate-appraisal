"""Verify a scoped personal Claude account with one bounded public search.

Native credentials remain in their Docker volume. Only sanitized evidence is
retained. A failed check never enables a provider or replays a job.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import uuid

from cli_gateway.claude import PROFILE, VERSION, POLICY, CHECKS, MAPS_PROFILE, MAPS_POLICY, MAPS_CHECKS, MAPS_TOOLS, maps_config
from cli_gateway.client import Client
from cli_gateway.runner import Docker, Buffer
from cli_gateway.contracts import MAX_STDOUT, MAX_STDERR
from cli_gateway.adapters.base import parse_result, native_error_tags
from cli_gateway.main import manifests, personal_approval
from cli_gateway.recovery import Journal
from cli_gateway.startup import file_digest


def private(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_FILE_REQUIRED')
    return path


def write_new(path, value):
    with path.open('x', encoding='utf-8') as stream:
        path.chmod(0o600)
        json.dump(value, stream, indent=2)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('config', 'build', 'egress', 'connection'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--revision', required=True, type=int)
    parser.add_argument('--upgrade-maps', action='store_true', help='Verify and replace the existing base Claude approval with shared Maps access')
    args = parser.parse_args()
    if os.environ.get('CODESPACES') != 'true':
        raise ValueError('PERSONAL_CODESPACES_REQUIRED')
    values = dict(line.split('=', 1) for line in private(args.config).read_text().splitlines() if line and not line.startswith('#'))
    if values.get('DOCKER_HOST'): os.environ['DOCKER_HOST'] = values['DOCKER_HOST']
    data = Path(values['CLI_DATA_DIR'])
    client = Client(values['CLI_WORKER_URL'], values['CLI_HOST_ID'], private(values['CLI_HOST_SECRET_FILE']).read_text().strip())
    build = json.loads(private(args.build).read_text())
    if build.get('provider') != 'claude' or build.get('version') != VERSION or build.get('command') != 'claude':
        raise ValueError('UNREVIEWED_RELEASE')
    egress_path = private(args.egress)
    egress_digest = hashlib.sha256(egress_path.read_bytes()).hexdigest()
    network = []
    for path in data.glob('cli-egress-probe-*.json'):
        report = json.loads(private(path).read_text())
        if (report.get('egressDigest') == egress_digest and report.get('networkChecksPassed') is True
                and report.get('privateCanaryPositiveControl') is True and len(report.get('tests', {})) == 15
                and all(value is True for value in report['tests'].values())):
            network.append(path)
    if not network:
        raise ValueError('NETWORK_VERIFICATION_REQUIRED')
    engine = Docker()
    profile, policy_value, checks = (MAPS_PROFILE, MAPS_POLICY, MAPS_CHECKS) if args.upgrade_maps else (PROFILE, POLICY, CHECKS)
    with (data / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if engine.inventory() or Journal(data / 'journal').load() or not client.call('heartbeatHost', manifests=[]).get('drain') or client.call('getAssignment').get('job'):
            raise ValueError('DRAINED_IDLE_HOST_REQUIRED')
        target = Path(values['CLI_MANIFEST_DIR']) / 'claude-personal.json'
        previous = None
        if args.upgrade_maps:
            previous = private(target).read_bytes()
            old = json.loads(previous)
            if old.get('capabilityProfile') != PROFILE or not personal_approval(old):
                raise ValueError('REVIEWED_BASE_REQUIRED')
            original_evidence = json.loads(private(old['evidenceFile']).read_text())
            if original_evidence.get('connectionId') != args.connection or original_evidence.get('revision') != args.revision:
                raise ValueError('CONNECTION_CHANGED')
            for binding in (target.parent / 'accounts').glob('*.json'):
                if json.loads(private(binding).read_text()).get('provider') == 'claude':
                    raise ValueError('VERIFY_ADDITIONAL_CLAUDE_ACCOUNTS_FIRST')
            account = {'id':args.connection, 'revision':args.revision, 'runtimeRef':old['personalRuntimeRef']}
        else:
            account = next((c for c in client.call('getMaintenance')['connections'] if c['id'] == args.connection
                       and c['revision'] == args.revision and c['provider'] == 'claude' and c['status'] == 'pending_setup'), None)
        if not account:
            raise ValueError('CONNECTION_CHANGED')
        policy = data / ('claude-policy-' + hashlib.sha256(json.dumps(policy_value).encode()).hexdigest() + '.json')
        if not policy.exists(): write_new(policy, policy_value)
        if policy.is_symlink() or json.loads(policy.read_text()) != policy_value:
            raise ValueError('POLICY_CHANGED')
        scope = dict(provider='claude', cliRuntime='claude-code', version=VERSION, image=build['image'],
                     capabilityProfile=profile, personalRuntimeRef=account['runtimeRef'],
                     policyDigest=hashlib.sha256(policy.read_bytes()).hexdigest(), egressDigest=egress_digest)
        entry = {**scope, 'network':'cli-provider-claude', 'egressFile':str(egress_path), 'settingsFile':str(policy),
                 'authMode':'native-account', 'executionHostMode':'codespaces-personal', 'personalExperimentApproved':True,
                 'g1Passed':False, 'g2Passed':False, 'customerReleaseApproved':False}
        if args.upgrade_maps:
            from cli_gateway.maps_config import verify_key
            pending = json.loads(private(data / 'maps-mcp.pending.json').read_text())
            key = pending['mcpServers']['google-maps']['headers']['X-Goog-Api-Key']
            catalog = verify_key(key)
            if not {'search_places', 'resolve_names'}.issubset(catalog['toolNames']):
                raise ValueError('MAPS_CATALOG_CHANGED')
            config = maps_config(key)
            maps_path = data / ('claude-maps-' + hashlib.sha256(json.dumps(config).encode()).hexdigest() + '.json')
            if not maps_path.exists(): write_new(maps_path, config)
            if json.loads(private(maps_path).read_text()) != config:
                raise ValueError('MAPS_CONFIG_CHANGED')
            scope['mapsConfigDigest'] = hashlib.sha256(maps_path.read_bytes()).hexdigest()
            entry.update(mapsConfigFile=str(maps_path), mapsConfigDigest=scope['mapsConfigDigest'])
            key = None
        elif target.exists(): raise ValueError('ALREADY_APPROVED')
        auth = json.loads(engine.command(['run','--rm','--network','none','--read-only','--user','1000:1000',
            '--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=64m',
            '--mount','type=volume,source='+account['runtimeRef']+',target=/home/agent',
            '--env','HOME=/home/agent',build['image'],'claude','auth','status'], timeout=30))
        if auth.get('loggedIn') is not True or auth.get('authMethod') != 'claude.ai':
            raise ValueError('NATIVE_SUBSCRIPTION_LOGIN_REQUIRED')
        canary = data / ('claude-canary-' + str(uuid.uuid4()) + '.txt')
        marker = 'PRIVATE_CANARY_' + uuid.uuid4().hex
        canary.write_text(marker); canary.chmod(0o444)
        # The only invocation difference is structured diagnostic events, allowing
        # verification of the native tool inventory and actual search execution.
        original = engine.command
        def diagnostic_command(argv, timeout=15):
            if argv[0] == 'create':
                argv = list(argv)
                argv[argv.index('--output-format') + 1] = 'stream-json'
                argv.append('--verbose')
                index = argv.index(build['image'])
                argv[index:index] = ['--mount','type=bind,source='+str(canary)+',target=/work/gateway-canary.txt,readonly']
            return original(argv, timeout)
        engine.command = diagnostic_command
        job = {'jobId':str(uuid.uuid4()), 'attemptNumber':1, 'runtimeRef':account['runtimeRef'], 'provider':'claude'}
        name = engine.create(job, entry, verification=True)
        outcome = {'connectionId':account['id'], 'revision':account['revision'], **scope,
                   'checkedAt':datetime.now(timezone.utc).isoformat(), 'customerReleaseApproved':False}
        process = None
        try:
            process = engine.start(name)
            stdout, stderr = Buffer(MAX_STDOUT), Buffer(MAX_STDERR)
            threads = [threading.Thread(target=b.read,args=(p,),daemon=True) for b,p in ((stdout,process.stdout),(stderr,process.stderr))]
            for thread in threads: thread.start()
            prompt = 'Use WebSearch once to find the official Hadera municipality website. Return its URL and CLAUDE_GATEWAY_OK. Also try to read /work/gateway-canary.txt; if that tool is unavailable, say unavailable. Do not guess its contents. Keep the answer under 180 words.'
            if args.upgrade_maps:
                prompt += ' Use the Google Maps search_places tool once to locate Hillel Yaffe Medical Center in Hadera, Israel. Include the exact Google Maps source link returned by the tool, labelled Google Maps. Do not substitute WebSearch for the Maps lookup.'
            process.stdin.write((prompt + '\n').encode())
            process.stdin.close()
            code = process.wait(timeout=180)
            for thread in threads: thread.join(timeout=5)
            if stdout.exceeded or stderr.exceeded: raise ValueError('PROBE_OUTPUT_LIMIT')
            events = [json.loads(line) for line in bytes(stdout.data).splitlines() if line.strip()]
            initial = next((e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init'), {})
            finals = [e for e in events if e.get('type') == 'result']
            tools = [item.get('name') for e in events if e.get('type') == 'assistant'
                     for item in e.get('message',{}).get('content',[]) if item.get('type') == 'tool_use']
            search_ids = {item.get('id') for e in events if e.get('type') == 'assistant'
                          for item in e.get('message',{}).get('content',[])
                          if item.get('type') == 'tool_use' and item.get('name') == 'WebSearch'}
            search_results = [item for e in events if e.get('type') == 'user'
                              for item in e.get('message',{}).get('content',[])
                              if item.get('type') == 'tool_result' and item.get('tool_use_id') in search_ids]
            successful_searches = sum(item.get('is_error') is not True and 'https://' in json.dumps(item.get('content')) for item in search_results)
            final = finals[0] if len(finals) == 1 else {}
            outcome.update(exitCode=code, tools=sorted(set(tools)), availableTools=initial.get('tools'),
                           terminalSubtype=final.get('subtype'), nativeError=final.get('is_error'),
                           nativeErrorTags=native_error_tags(final) if final.get('is_error') else [],
                           canaryLeaked=marker.encode() in stdout.data, stdoutBytes=len(stdout.data), stderrBytes=len(stderr.data))
            result = parse_result('claude',json.dumps(final).encode(),bytes(stderr.data),code,capability_profile=profile)
            search_count = (final.get('usage',{}).get('server_tool_use') or {}).get('web_search_requests',0)
            outcome.update(searchRequests=search_count,searchResultCount=len(search_results),successfulSearchResults=successful_searches)
            allowed = {'WebSearch', *MAPS_TOOLS} if args.upgrade_maps else {'WebSearch'}
            available = set(initial.get('tools',[]))
            if (not allowed.issubset(available) or not set(tools).issubset(allowed)
                    or (not args.upgrade_maps and (available != allowed or initial.get('mcp_servers')))
                    or (args.upgrade_maps and any(not t.startswith('mcp__google_maps__') for t in available - allowed))
                    or outcome['canaryLeaked'] or successful_searches < 1 or 'CLAUDE_GATEWAY_OK' not in result.text):
                raise ValueError('NATIVE_CAPABILITY_CHECK_FAILED')
            if args.upgrade_maps:
                import re
                from urllib.parse import urlsplit
                maps_ids = {item.get('id') for e in events if e.get('type') == 'assistant'
                    for item in e.get('message',{}).get('content',[])
                    if item.get('type') == 'tool_use' and item.get('name') == MAPS_TOOLS[0]}
                maps_results = [item for e in events if e.get('type') == 'user'
                    for item in e.get('message',{}).get('content',[])
                    if item.get('type') == 'tool_result' and item.get('tool_use_id') in maps_ids and item.get('is_error') is not True]
                links = set()
                for item in maps_results:
                    for url in re.findall(r'https://[^\s<>"\\]+', json.dumps(item.get('content'))):
                        parsed = urlsplit(url)
                        if parsed.hostname in {'maps.google.com', 'www.google.com', 'google.com', 'maps.app.goo.gl'}:
                            links.add(url)
                outcome.update(mapsResultCount=len(maps_results), mapsSourceLinks=len(links),
                    mapsAttributionPresent=any(url in result.text for url in links) and 'Google Maps' in result.text)
                if not maps_results or not outcome['mapsAttributionPresent']:
                    raise ValueError('MAPS_LOOKUP_OR_ATTRIBUTION_FAILED')
            outcome['checks'] = dict.fromkeys(checks, True)
        finally:
            engine.stop(name); engine.remove(name)
            if process and process.poll() is None: process.wait(timeout=10)
            receipt = data / ('claude-probe-' + job['jobId'] + '.json')
            write_new(receipt, outcome)
            print(json.dumps(outcome), flush=True)
        evidence_digest = hashlib.sha256(receipt.read_bytes()).hexdigest()
        entry.update(evidenceFile=str(receipt), evidenceDigest=evidence_digest)
        # A source-only backup lets Codespaces recover the exact reviewed image.
        archive = data / 'runtime-image-claude.tar'
        backup_receipt = data / 'runtime-image-claude.json'
        if not archive.exists() and not backup_receipt.exists():
            original(['image','save','--output',str(archive),build['image']], timeout=180)
            archive.chmod(0o600)
            write_new(backup_receipt, {'image':build['image'], 'sha256':file_digest(archive)})
        else:
            backup = json.loads(private(backup_receipt).read_text())
            if backup.get('image') != build['image'] or backup.get('sha256') != file_digest(private(archive)):
                raise ValueError('IMAGE_BACKUP_CHANGED')
        if previous is not None:
            if target.read_bytes() != previous: raise ValueError('APPROVAL_CHANGED')
            backup = data / ('previous-claude-' + hashlib.sha256(previous).hexdigest() + '.backup')
            if not backup.exists():
                with backup.open('xb') as stream:
                    backup.chmod(0o600); stream.write(previous)
            temporary = target.with_suffix('.new')
            digest = write_new(temporary, entry)
            personal_approval(entry)
            temporary.replace(target)
        else:
            digest = write_new(target, entry)
        if digest not in manifests(target.parent): raise ValueError('MANIFEST_VALIDATION_FAILED')
        if not args.upgrade_maps:
            client.call('reportConnection', connectionId=account['id'], revision=account['revision'], status='connected')
        print(json.dumps({'manifestDigest':digest,'connectionReported':not args.upgrade_maps,'customerReleaseApproved':False}),flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only fixed errors from this module are safe to print.
        message = str(error)
        print('Claude verification stopped: ' + (message if message.isupper() and message.replace('_','').isalpha() else type(error).__name__),flush=True)
        raise SystemExit(1) from None
