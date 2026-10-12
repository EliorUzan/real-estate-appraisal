import io
import json
import unittest
import subprocess
import sys
import tempfile
import socket
import threading
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from cli_gateway.adapters import parse_result, invocation, prompt_input
from cli_gateway.contracts import GatewayError, MAX_ANSWER, MAX_EVENT
from cli_gateway.runner import Buffer, container_name, Runner, Docker, GOOGLE_AGENT
from cli_gateway.main import recover, personal_approval, PERSONAL_CHECKS
from cli_gateway.egress import authority, public_addresses, Server


class ParserTests(unittest.TestCase):
    def test_research_runtime_is_bounded_and_other_profiles_unchanged(self):
        from cli_gateway.contracts import runtime_seconds
        from cli_gateway.research import PROFILE
        for provider, profile, seconds in [('gemini', PROFILE, 600), ('gemini', None, 300), ('openai', PROFILE, 300), ('claude', None, 300)]:
            self.assertEqual(runtime_seconds(provider, profile), seconds)
            if provider == 'gemini':
                command = invocation(provider, capability_profile=profile)
                self.assertEqual(command[command.index('--print-timeout')+1], f'{seconds-30}s')

    def test_failure_diagnostics_never_expose_native_content(self):
        from cli_gateway.adapters.base import stream_diagnostics
        secret='PRIVATE_SENTINEL'
        events=[{'event':'step_update','step_update':{'step_type':'tool','step_index':1,'text_delta':secret}},
                {'event':'result','result':{'status':'INTERRUPTED','num_turns':1,'response':secret,'error':secret}}]
        report=stream_diagnostics('\n'.join(json.dumps(e) for e in events).encode())
        self.assertNotIn(secret,json.dumps(report))
        self.assertEqual(report['terminalStatus'],'INTERRUPTED')
        self.assertEqual(report['toolSteps'],1)
        self.assertEqual(report['answerBytes'],len(secret))

    def test_search_profile_accepts_native_search_but_rejects_other_tools(self):
        import hashlib
        from cli_gateway.research import PROFILE, AGENT_NAME
        registry=['search_web','read_url_content','view_file','run_command']
        digest=hashlib.sha256(json.dumps(registry,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        init={'event':'init','init':{'tools':registry,'agent':AGENT_NAME,'permission_mode':'strict'}}
        final={'event':'result','result':{'status':'SUCCESS','num_turns':1,'response':'source https://example.org/'}}
        step={'event':'step_update','step_update':{'step_type':'tool','tool_name':'search_web',
            'state':'DONE','tool_info':{'name':'search_web','parameters':{'query':'public research'}}}}
        encode=lambda events:'\n'.join(json.dumps(e) for e in events).encode()
        def parse(events,**kwargs):return parse_result('gemini',encode(events),b'',0,
            tool_registry_digest=digest,capability_profile=PROFILE,**kwargs)
        self.assertIn('https://',parse([init,step,final]).text)
        for name in ('read_url_content','view_file','run_command','mcp_maps/search_places'):
            forbidden={**step,'step_update':{**step['step_update'],'tool_name':name,'tool_info':{'name':name}}}
            with self.assertRaises(GatewayError):parse([init,forbidden,final])
        for changed in ({'subagent_info':{'id':'other'}},{'tool_name':'view_file'}, {'tool_call':{'name':'search_web'}}):
            with self.assertRaises(GatewayError):parse([init,{**step,'step_update':{**step['step_update'],**changed}},final])
        with self.assertRaises(GatewayError):parse([init]+[step]*65+[final])
        indexed={**step,'step_update':{**step['step_update'],'step_index':2}}
        # A normal long stream can update one search many times.
        self.assertIn('https://',parse([init]+[indexed]*200+[final]).text)
        distinct=[{**step,'step_update':{**step['step_update'],'step_index':i}} for i in range(65)]
        with self.assertRaises(GatewayError) as exceeded:parse([init]+distinct+[final])
        self.assertEqual(exceeded.exception.detail,'tool_steps')
        for index in (-1,True,'2'):
            with self.assertRaises(GatewayError):parse([init,{**step,'step_update':{**step['step_update'],'step_index':index}},final])
        forbidden={**indexed,'step_update':{**indexed['step_update'],'tool_name':'view_file','tool_info':{'name':'view_file'}}}
        with self.assertRaises(GatewayError):parse([init,indexed,forbidden,final])
        with self.assertRaises(GatewayError):parse_result('gemini',encode([init,step,final]),b'',0,capability_profile=PROFILE)
        with self.assertRaises(GatewayError):parse_result('gemini',encode([init,step,final]),b'',0,tool_registry_digest=digest)
        self.assertEqual(invocation('gemini',capability_profile=PROFILE)[-1],AGENT_NAME)

    def test_search_evidence_cannot_reuse_text_only_approval(self):
        import hashlib
        from cli_gateway.research import PROFILE, CHECKS
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ',{'CODESPACES':'true'}):
            path=Path(folder)/'evidence.json'
            scope=dict(provider='gemini',cliRuntime='antigravity',version='1.3.3',image='sha256:'+'a'*64,
                personalRuntimeRef='cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b',policyDigest='b'*64,
                agentDigest='c'*64,egressDigest='d'*64,toolRegistryDigest='e'*64)
            entry={**scope,'capabilityProfile':PROFILE,'personalExperimentApproved':True,
                'executionHostMode':'codespaces-personal','customerReleaseApproved':False,'g1Passed':False,'g2Passed':False,
                'evidenceFile':str(path.resolve())}
            def check(report):
                path.write_text(json.dumps(report))
                return personal_approval({**entry,'evidenceDigest':hashlib.sha256(path.read_bytes()).hexdigest()})
            text={**scope,'checks':{key:True for key in PERSONAL_CHECKS},'customerReleaseApproved':False}
            with self.assertRaises(ValueError):check(text)
            search={**text,'capabilityProfile':PROFILE,'checks':{key:True for key in CHECKS}}
            self.assertTrue(check(search))
            with self.assertRaises(ValueError):check({**search,'checks':{**search['checks'],'webSearchVerified':False}})

    def test_reviewed_registry_does_not_allow_changed_tools_or_tool_events(self):
        import hashlib
        tools = ['view_file', 'run_command']
        digest = hashlib.sha256(json.dumps(tools, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        init = {'event':'init', 'init':{'tools':tools, 'agent':'cli-gateway-text', 'permission_mode':'strict'}}
        final = {'event':'result', 'result':{'status':'SUCCESS', 'num_turns':1, 'response':'text only'}}
        encode = lambda events: '\n'.join(json.dumps(e) for e in events).encode()
        self.assertEqual(parse_result('gemini', encode([init, final]), b'', 0, tool_registry_digest=digest).text, 'text only')
        for events in ([{**init, 'init':{**init['init'], 'tools':tools + ['mcp_private']}}, final],
                       [init, {'event':'step_update', 'step_update':{'step_type':'tool', 'tool_info':{'error':{'message':'denied'}}}}, final]):
            with self.assertRaises(GatewayError):
                parse_result('gemini', encode(events), b'', 0, tool_registry_digest=digest)
        with self.assertRaises(GatewayError):
            parse_result('gemini', encode([init, final]), b'', 0)

    def test_personal_approval_requires_bound_evidence_and_cannot_be_customer_release(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            evidence = Path(folder) / 'evidence.json'
            scope = dict(provider='gemini', cliRuntime='antigravity', version='1.3.3', image='sha256:'+'a'*64,
                personalRuntimeRef='cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b', policyDigest='b'*64,
                agentDigest='c'*64, egressDigest='d'*64, toolRegistryDigest='e'*64)
            report = {**scope, 'checks':{key:True for key in PERSONAL_CHECKS}, 'customerReleaseApproved':False}
            evidence.write_text(json.dumps(report))
            entry = {**scope, 'personalExperimentApproved':True, 'executionHostMode':'codespaces-personal',
                'customerReleaseApproved':False, 'g1Passed':False, 'g2Passed':False,
                'evidenceFile':str(evidence.resolve()), 'evidenceDigest':hashlib.sha256(evidence.read_bytes()).hexdigest()}
            with patch.dict('os.environ', {'CODESPACES':'true'}):
                self.assertTrue(personal_approval(entry))
                for changed in ({'customerReleaseApproved':True}, {'g1Passed':True},
                                {'personalRuntimeRef':'cli-home-other'}, {'evidenceDigest':'f'*64}):
                    with self.assertRaises(ValueError):personal_approval({**entry, **changed})
                evidence.write_text(json.dumps({**report, 'checks':{**report['checks'], 'nativeReadDenied':False}}))
                with self.assertRaises(ValueError):personal_approval({**entry, 'evidenceDigest':hashlib.sha256(evidence.read_bytes()).hexdigest()})
            with patch.dict('os.environ', {'CODESPACES':'false'}):
                with self.assertRaises(ValueError):personal_approval(entry)

    def test_antigravity_rejects_tools_and_changed_agent_even_after_success(self):
        initial = {'tools': [], 'agent': 'cli-gateway-text', 'permission_mode': 'strict'}
        final = {'event': 'result', 'result': {'status': 'SUCCESS', 'num_turns': 1, 'response': 'answer'}}
        for changed in ({'tools': ['view_file']}, {'agent': 'self'}, {'permission_mode': 'always-proceed'}, {'tools': None}):
            events = [{'event': 'init', 'init': {**initial, **changed}}, final]
            with self.assertRaises(GatewayError):
                parse_result('gemini', '\n'.join(json.dumps(e) for e in events).encode(), b'', 0)
        for step in ({'step_type': 'tool'}, {'subagent_info': {'id': 'private'}}, {'tool_info': {'name': 'view_file'}}):
            events = [{'event': 'init', 'init': initial}, {'event': 'step_update', 'step_update': step}, final]
            with self.assertRaises(GatewayError):
                parse_result('gemini', '\n'.join(json.dumps(e) for e in events).encode(), b'', 0)

    def test_google_refuses_agent_definition_with_tools_even_when_hash_matches(self):
        import hashlib
        root = Path(__file__).resolve().parents[2]
        self.assertEqual((root/'deploy/cli-gateway/antigravity-text-agent.md').read_bytes(), GOOGLE_AGENT)
        engine = Docker(executable=sys.executable)
        engine.command = lambda *args,**kwargs:self.fail('Unapproved agent reached Docker')
        job={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,
             'runtimeRef':'cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b','provider':'gemini'}
        with tempfile.TemporaryDirectory() as folder:
            settings=Path(folder)/'settings.json'
            settings.write_bytes((root/'deploy/cli-gateway/antigravity-settings.json').read_bytes())
            agent=Path(folder)/'agent.md'
            agent.write_bytes(GOOGLE_AGENT.replace(b'tools: []', b'tools: [run_command]'))
            manifest={'image':'test@sha256:'+'a'*64,'network':'none','cliRuntime':'antigravity',
                      'settingsFile':str(settings.resolve()),'policyDigest':hashlib.sha256(settings.read_bytes()).hexdigest(),
                      'agentFile':str(agent.resolve()),'agentDigest':hashlib.sha256(agent.read_bytes()).hexdigest()}
            with self.assertRaisesRegex(ValueError,'agent changed'):engine.create(job,manifest)

    def test_relay_denies_real_connect_requests_without_logging_headers(self):
        # Exercise actual sockets and HTTP framing, not just the authority parser.
        output = io.StringIO()
        with Server(('127.0.0.1', 0), {'oauth2.googleapis.com'}) as server, redirect_stdout(output):
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval':0.01}, daemon=True)
            thread.start()
            try:
                requests = (
                    b'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n',
                    b'CONNECT oauth2.googleapis.com:443 HTTP/1.1\r\nAuthorization: SECRET_SENTINEL\r\n\r\n',
                )
                with patch('cli_gateway.egress.public_addresses') as resolver:
                    for request in requests:
                        with socket.create_connection(server.server_address, timeout=2) as client:
                            client.sendall(request)
                            self.assertTrue(client.recv(256).startswith(b'HTTP/1.1 403 '))
                    resolver.assert_not_called()
            finally:
                server.shutdown()
                thread.join(timeout=2)
        self.assertNotIn('SECRET_SENTINEL', output.getvalue())
        self.assertNotIn('example.com', output.getvalue())
        self.assertEqual([json.loads(line) for line in output.getvalue().splitlines()],
                         [{'event':'denied','reason':'DENIED_AUTHORITY'}, {'event':'denied','reason':'DENIED_HEADER'}])

    def test_egress_rejects_unapproved_names_ports_literals_and_dns_rebinding(self):
        allowed={'oauth2.googleapis.com'}
        self.assertEqual(authority('oauth2.googleapis.com:443',allowed),'oauth2.googleapis.com')
        for target in ('oauth2.googleapis.com:80','oauth2.googleapis.com.:443','x.oauth2.googleapis.com:443',
                       'user@oauth2.googleapis.com:443','169.254.169.254:443','[::1]:443','example.com:443'):
            with self.assertRaises(ValueError):authority(target,allowed)
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('142.250.1.1',443)),(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):public_addresses('oauth2.googleapis.com')

    def test_native_probe_diagnostics_do_not_publish_authentication_material(self):
        import importlib.util
        path=Path(__file__).resolve().parents[2]/'deploy/cli-gateway/verify-native.py'
        spec=importlib.util.spec_from_file_location('native_probe',path)
        probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
        marker='SECRET_SENTINEL_NOT_FOR_OUTPUT'
        stdout=json.dumps({'event':'result','result':{'status':'ERROR','error':marker,'response':marker}}).encode()
        stderr=('Authentication required https://accounts.google.com/auth?code='+marker).encode()
        report=probe.diagnostics(stdout,stderr)
        self.assertNotIn(marker,json.dumps(report))
        self.assertNotIn('https://',json.dumps(report))
        self.assertIn('NATIVE_SIGNIN_REQUIRED',report['categories'])

    def test_native_terminal_envelopes_and_unicode(self):
        answer='תיאור 😀'
        claude={'type':'result','subtype':'success','is_error':False,'result':answer,'usage':{'input_tokens':3,'output_tokens':2}}
        gemini='\n'.join(json.dumps(x) for x in [{'event':'init','init':{'tools':[], 'agent':'cli-gateway-text', 'permission_mode':'strict'}}, {'event':'step_update','step_update':{'text_delta':'private reasoning'}}, {'event':'result','result':{'status':'SUCCESS','num_turns':1,'response':answer,'usage':{'input_tokens':3,'output_tokens':2}}}])
        codex='\n'.join(json.dumps(x) for x in [{'type':'item.completed','item':{'type':'reasoning','text':'must not show'}}, {'type':'item.completed','item':{'type':'agent_message','text':answer}},{'type':'turn.completed','usage':{'input_tokens':3,'output_tokens':2}}])
        for provider,raw in [('claude',json.dumps(claude)),('gemini',gemini),('openai',codex)]:
            result=parse_result(provider,raw.encode(),b'',0)
            self.assertEqual(result.text,answer)
            self.assertEqual(result.input_tokens,3)
            self.assertNotIn('must not show',result.text)

    def test_partial_failed_and_oversized_output_are_never_success(self):
        cases=[('openai',b'{"type":"turn.completed"}',0),('gemini',b'{"response":"valid"}',1),('gemini',b'{"response":"valid","error":{"message":"oops"}}',0),('claude',b'{"result":"valid"}',0),('gemini',b'\xff',0),('openai',json.dumps({'type':'unknown','data':'x'*MAX_EVENT}).encode(),0),('gemini',json.dumps({'response':'x'*(MAX_ANSWER+1)}).encode(),0)]
        for provider,raw,code in cases:
            with self.assertRaises(GatewayError):parse_result(provider,raw,b'',code)

    def test_bounded_reader(self):
        buffer=Buffer(10);buffer.read(io.BytesIO(b'x'*11))
        self.assertTrue(buffer.exceeded)
        self.assertLessEqual(len(buffer.data),10)

    def test_antigravity_requires_one_successful_terminal_turn(self):
        init=json.dumps({'event':'init','init':{'tools':[], 'agent':'cli-gateway-text', 'permission_mode':'strict'}})+'\n'
        terminal={'status':'SUCCESS','response':'synthetic','num_turns':1}
        final=lambda value:json.dumps({'event':'result','result':value})
        cases=[json.dumps({'response':'legacy Gemini output'}), init, final(terminal),
               init+final(terminal)+'\n'+final(terminal),
               init+final({**terminal,'num_turns':2}), init+final({**terminal,'num_turns':True})]
        cases.extend(init+final({**terminal,'status':status}) for status in ('ERROR','WAITING','RUNNING','CANCELED','INTERRUPTED','INVALID'))
        for raw in cases:
            with self.assertRaises(GatewayError):parse_result('gemini',raw.encode(),b'',0)

    def test_antigravity_stdin_is_one_json_message_even_with_newlines(self):
        text='תיאור 😀\n"quoted"\n$(touch /tmp/should-not-run)'
        payload=prompt_input('gemini','fixed instructions',text)
        self.assertEqual(payload.count(b'\n'),1)
        self.assertEqual(json.loads(payload),{'event':'user','message':{'content':'fixed instructions\n\n'+text}})
        self.assertEqual(invocation('gemini')[0],'agy')

    def test_fixed_arguments_and_names(self):
        for provider in ('claude','openai','gemini'):
            self.assertIsInstance(invocation(provider),list)
        with self.assertRaises(GatewayError):invocation('$(rm -rf /)')
        with self.assertRaises(ValueError):container_name('../../other',1)

    def test_codespaces_personal_mode_cannot_mount_another_native_home(self):
        engine=Docker(executable=sys.executable)
        engine.command=lambda *args,**kwargs:self.fail('Engine invoked outside approved personal scope')
        job={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,
             'runtimeRef':'cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b'}
        manifest={'executionHostMode':'codespaces-personal','customerReleaseApproved':False,
                  'personalRuntimeRef':'cli-home-749698ca-b7d6-4dbd-b48b-406ef8405a6b'}
        with patch.dict('os.environ',{'CODESPACES':'true'}):
            with self.assertRaisesRegex(GatewayError,'PERSONAL_RUNTIME_SCOPE_REQUIRED'):engine.create(job,manifest)

    def test_local_image_ids_are_limited_to_the_approved_personal_host(self):
        engine=Docker(executable=sys.executable)
        calls=[]
        engine.command=lambda args,**kwargs:calls.append(args)
        runtime='cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b'
        job={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,
             'runtimeRef':runtime,'provider':'openai'}
        manifest={'image':'sha256:'+'a'*64,'network':'none'}
        with self.assertRaises(ValueError):engine.create(job,manifest)
        self.assertEqual(calls,[])
        manifest.update(executionHostMode='codespaces-personal',customerReleaseApproved=False,personalRuntimeRef=runtime)
        with patch.dict('os.environ',{'CODESPACES':'true'}):engine.create(job,manifest)
        self.assertIn(manifest['image'],calls[0])

    def test_google_cannot_execute_with_a_missing_or_relaxed_policy(self):
        engine=Docker(executable=sys.executable)
        engine.command=lambda *args,**kwargs:self.fail('Unapproved Google policy reached Docker')
        job={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,
             'runtimeRef':'cli-home-849698ca-b7d6-4dbd-b48b-406ef8405a6b','provider':'gemini'}
        manifest={'image':'test@sha256:'+'a'*64,'network':'none','cliRuntime':'antigravity'}
        with self.assertRaises(ValueError):engine.create(job,manifest)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'settings.json';path.write_text('{"toolPermission":"always-proceed"}')
            import hashlib
            manifest.update(settingsFile=str(path.resolve()),policyDigest=hashlib.sha256(path.read_bytes()).hexdigest())
            with self.assertRaises(ValueError):engine.create(job,manifest)


class RecoveryTests(unittest.TestCase):
    def test_research_round_trip_preserves_prompt_and_logs_only_tool_metadata(self):
        import hashlib
        from cli_gateway.research import PROFILE, AGENT_NAME
        registry=['search_web']
        fingerprint=hashlib.sha256(json.dumps(registry,separators=(',',':')).encode()).hexdigest()
        job={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,'leaseToken':'private-lease',
            'instructions':'original report instructions','inputText':'original user input','provider':'gemini'}
        events=[{'event':'init','init':{'tools':registry,'agent':AGENT_NAME,'permission_mode':'strict'}},
            {'event':'step_update','step_update':{'step_type':'tool','tool_name':'search_web','state':'DONE',
                'tool_info':{'name':'search_web','parameters':{'query':'PRIVATE_QUERY_SENTINEL'}}}},
            {'event':'result','result':{'status':'SUCCESS','num_turns':1,'response':'public answer'}}]
        calls=[]
        class Engine:
            def create(self,j,m):calls.append('create')
            def start(self,n):
                calls.append('start')
                script='import sys,json; p=json.loads(sys.stdin.read()); assert p["message"]["content"]=="original report instructions\\n\\noriginal user input"; print('+repr('\n'.join(json.dumps(e) for e in events))+')'
                return subprocess.Popen([sys.executable,'-c',script],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            def stop(self,n):return {'ExitCode':0}
            def remove(self,n):calls.append('remove')
        class Client:
            def call(self,action,**fields):
                if action=='authorizeStart':return {'authorized':True}
                if action=='complete':
                    assert fields['result']['text']=='public answer'
                    return {'acknowledged':True}
                return {'stop':False}
        class Journal:
            def save(self,v):pass
            def clear(self):pass
        output=io.StringIO()
        with redirect_stdout(output):Runner(Engine(),Client(),Journal()).run(job,{'capabilityProfile':PROFILE,'toolRegistryDigest':fingerprint})
        self.assertEqual(calls.count('start'),1)
        audit=json.loads(output.getvalue())
        self.assertEqual(audit['toolNames'],['search_web'])
        self.assertNotIn('PRIVATE_QUERY_SENTINEL',output.getvalue())
        self.assertNotIn('private-lease',output.getvalue())
        self.assertNotIn(job['instructions'],output.getvalue())

    def test_recovery_only_reads_assignment_and_never_starts(self):
        ids={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,'leaseToken':'original'}
        name=container_name(ids['jobId'],1)
        calls=[]
        class Engine:
            def inventory(self):return [name]
            def stop(self,n):calls.append(('stop',n))
            def remove(self,n):calls.append(('remove',n))
        class Client:
            def call(self,action,**fields):
                calls.append((action,fields));return {'job':ids} if action=='getAssignment' else {'acknowledged':True}
        class Journal:
            def load(self):return {**ids,'phase':'start_intent'}
            def clear(self):calls.append(('clear',None))
        recover(Engine(),Client(),Journal())
        self.assertEqual([c[0] for c in calls],['getAssignment','stop','reconcile','remove','clear'])
        self.assertFalse(any(c[0] in ('claim','start') for c in calls))

    def test_runner_retries_only_completion_after_lost_ack(self):
        ids={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,'leaseToken':'original'}
        job={**ids,'instructions':'synthetic','inputText':'Hebrew test','provider':'gemini'}
        calls=[]
        class Engine:
            def create(self,j,m):calls.append('create')
            def start(self,n):
                calls.append('start')
                return subprocess.Popen([sys.executable,'-c','import sys,json; payload=json.loads(sys.stdin.read()); assert payload["event"]=="user"; print(json.dumps({"event":"init","init":{"tools":[],"agent":"cli-gateway-text","permission_mode":"strict"}}));print(json.dumps({"event":"result","result":{"status":"SUCCESS","num_turns":1,"response":"synthetic answer"}}))'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            def stop(self,n):calls.append('stop');return {'ExitCode':0}
            def remove(self,n):calls.append('remove')
        class Client:
            attempts=0
            def call(self,action,**fields):
                calls.append(action)
                if action=='authorizeStart':return {'authorized':True}
                if action=='complete':
                    self.attempts+=1
                    if self.attempts==1:raise OSError('lost acknowledgement')
                    assert fields['result']['text']=='synthetic answer'
                    return {'acknowledged':True}
                return {'stop':False}
        class Journal:
            def save(self,v):calls.append('journal:'+v['phase'])
            def clear(self):calls.append('clear')
        Runner(Engine(),Client(),Journal()).run(job,{})
        self.assertEqual(calls.count('start'),1)
        self.assertEqual(calls.count('complete'),2)
        self.assertLess(calls.index('journal:start_intent'),calls.index('start'))
        self.assertLess(calls.index('stop'),calls.index('complete'))

    def test_unknown_container_is_stopped_and_quarantined_during_recovery(self):
        ids={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,'leaseToken':'original'}
        name=container_name(ids['jobId'],1)
        calls=[]
        class Engine:
            def inventory(self):return [name,'unexpected']
            def stop(self,n):calls.append(('stop',n))
            def remove(self,n):calls.append(('remove',n))
        class Client:
            def call(self,action,**fields):
                calls.append((action,fields));return {'job':ids} if action=='getAssignment' else {'acknowledged':True}
        class Journal:
            def load(self):return ids
            def clear(self):calls.append(('clear',None))
        with self.assertRaisesRegex(GatewayError,'UNKNOWN_CONTAINER'):recover(Engine(),Client(),Journal())
        self.assertLess(calls.index(('stop','unexpected')),next(i for i,c in enumerate(calls) if c[0]=='quarantineHost'))
        self.assertIn('reconcile',[c[0] for c in calls])
        self.assertNotIn('claim',[c[0] for c in calls])

    def test_success_envelope_cannot_override_native_exit_failure(self):
        ids={'jobId':'849698ca-b7d6-4dbd-b48b-406ef8405a6b','attemptNumber':1,'leaseToken':'original'}
        job={**ids,'instructions':'synthetic','inputText':'test','provider':'gemini'}
        class Engine:
            def create(self,j,m):pass
            def start(self,n):
                return subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.read();print(\'{"response":"misleading success"}\')'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            def stop(self,n):return {'ExitCode':1}
            def remove(self,n):pass
        class Client:
            result=None
            def call(self,action,**fields):
                if action=='authorizeStart':return {'authorized':True}
                if action=='complete':self.result=fields['result'];return {'acknowledged':True}
                return {'stop':False}
        class Journal:
            def save(self,v):pass
            def clear(self):pass
        client=Client()
        Runner(Engine(),client,Journal()).run(job,{})
        self.assertEqual(client.result['errorCode'],'CLI_FAILED')
        self.assertIsNone(client.result['text'])


if __name__=='__main__':unittest.main()
