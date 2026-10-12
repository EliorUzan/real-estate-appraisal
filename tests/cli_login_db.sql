-- Disposable fixture only, always rolled back; no live OAuth material.
begin;
do $$
declare u uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); host uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid(); session uuid; conn uuid; lease uuid; challenge uuid:=gen_random_uuid(); key uuid:=gen_random_uuid(); submission uuid:=gen_random_uuid(); body jsonb; envelope jsonb; r jsonb;
begin
 insert into auth.users(id) values(u),(other);
 insert into public.workspaces(id,name) values(w,'Native login synthetic');
 insert into public.workspace_members(workspace_id,user_id,status) values(w,u,'active'),(w,other,'active');
 -- This isolated fixture has no production host or active job.
 insert into private.cli_hosts(id,enabled,token_hash,status,last_seen_at,manifests,login_protocol) values(host,true,repeat('e',64),'ready',clock_timestamp(),jsonb_build_array(repeat('d',64)),'antigravity-login-v1');
 update private.cli_providers set enabled=true,manifest_digest=repeat('d',64) where provider_id='gemini';
 insert into private.cli_onboarding_config(host_id,enabled,allowed_owners,login_manifest_digest) values(host,true,array[u],repeat('c',64));
 body:=jsonb_build_object('provider','gemini','requestId',request);
 r:=public.cli_onboarding_user_action(u,'startCliLogin',body);session:=(r->'session'->>'id')::uuid;
 if session is null or (public.cli_onboarding_user_action(u,'startCliLogin',body)->'session'->>'id')::uuid<>session then raise exception 'Start idempotency failed';end if;
 begin perform public.cli_onboarding_user_action(other,'getCliLogin',jsonb_build_object('sessionId',session));raise exception 'Owner check absent';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
 begin perform public.cli_onboarding_user_action(other,'startCliLogin',jsonb_build_object('requestId',gen_random_uuid()));raise exception 'Allowlist check absent';exception when others then if sqlerrm<>'ONBOARDING_DISABLED' then raise;end if;end;
 r:=public.cli_onboarding_worker_action(host,'claimLogin','{}')->'login';lease:=(r->>'leaseToken')::uuid;conn:=(r->>'connectionId')::uuid;
 if lease is null then raise exception 'Claim failed';end if;
 if public.cli_worker_action(host,'claim','{}')->'job'<>'null'::jsonb then raise exception 'Inference entered reserved slot';end if;
 begin perform public.cli_worker_action(host,'reportConnection',jsonb_build_object('connectionId',conn,'revision',1,'status','connected'));raise exception 'Legacy bypass';exception when others then if sqlerrm<>'ONBOARDING_REQUIRED' then raise;end if;end;
 body:=jsonb_build_object('sessionId',session,'leaseToken',lease);
 perform public.cli_onboarding_worker_action(host,'registerLoginContainer',body||jsonb_build_object('containerRef','cli-login-'||session::text||'-auth','containerKind','login','previousStopped',false));
 perform public.cli_onboarding_worker_action(host,'publishLoginChallenge',body||jsonb_build_object('challengeId',challenge,'keyId',key,'authorizationUrl','https://accounts.google.com/o/oauth2/v2/auth?synthetic=true','publicKeyJwk','{"kty":"RSA","n":"synthetic","e":"AQAB"}'::jsonb,'expiresAt',clock_timestamp()+interval '290 seconds'));
 envelope:=jsonb_build_object('version',1,'algorithm','RSA-OAEP-3072-SHA256+A256GCM','keyId',key,'wrappedKey','synthetic','iv','synthetic','ciphertext','synthetic');
 r:=public.cli_onboarding_user_action(u,'submitCliLoginCode',jsonb_build_object('sessionId',session,'challengeId',challenge,'submissionId',submission,'envelope',envelope));
 if r->'session'->>'state'<>'code_received' then raise exception 'Delivery not accepted';end if;
 perform public.cli_onboarding_user_action(u,'submitCliLoginCode',jsonb_build_object('sessionId',session,'challengeId',challenge,'submissionId',submission,'envelope',envelope));
 begin perform public.cli_onboarding_user_action(u,'submitCliLoginCode',jsonb_build_object('sessionId',session,'challengeId',challenge,'submissionId',submission,'envelope',envelope||'{"ciphertext":"changed"}'));raise exception 'Changed envelope accepted';exception when others then if sqlerrm<>'REQUEST_ID_CONFLICT' then raise;end if;end;
 r:=public.cli_onboarding_worker_action(host,'consumeLoginCode',body||jsonb_build_object('submissionId',submission));
 if r->>'alreadyConsumed'<>'false' or exists(select 1 from private.cli_login_envelopes where session_id=session) then raise exception 'Consumption failed';end if;
 if public.cli_onboarding_worker_action(host,'consumeLoginCode',body||jsonb_build_object('submissionId',submission))->>'alreadyConsumed'<>'true' then raise exception 'Consumption replay not fenced';end if;
 perform public.cli_onboarding_worker_action(host,'beginLoginVerification',body);
 perform public.cli_onboarding_worker_action(host,'registerLoginContainer',body||jsonb_build_object('containerRef','cli-login-'||session::text||'-verify','containerKind','login_verification','previousStopped',true));
 r:=public.cli_onboarding_worker_action(host,'completeLogin',body||jsonb_build_object('stopped',true,'outcome','quota_blocked','errorCode',null,'receiptDigest',repeat('f',64)));
 if r->>'state'<>'verification_blocked' or (select native_authenticated_at from private.cli_connections where id=conn) is null then raise exception 'Quota discarded saved login';end if;
 r:=public.cli_onboarding_user_action(u,'verifyCliConnection',jsonb_build_object('requestId',gen_random_uuid(),'connectionId',conn));session:=(r->'session'->>'id')::uuid;
 if r->'session'->>'kind'<>'verify_only' then raise exception 'Verification started interactive login';end if;
 r:=public.cli_onboarding_worker_action(host,'claimLogin','{}')->'login';lease:=(r->>'leaseToken')::uuid;body:=jsonb_build_object('sessionId',session,'leaseToken',lease);
 perform public.cli_onboarding_worker_action(host,'beginLoginVerification',body);
 -- Cancel wins over a later stopped-success acknowledgement.
 perform public.cli_onboarding_user_action(u,'cancelCliLogin',jsonb_build_object('sessionId',session));
 r:=public.cli_onboarding_worker_action(host,'completeLogin',body||jsonb_build_object('stopped',true,'outcome','succeeded','errorCode',null,'receiptDigest',repeat('f',64)));
 if r->>'state'<>'cancelled' or (select status from private.cli_connections where id=conn)='connected' then raise exception 'Cancelled login resurrected';end if;
 if (select active_login_id from private.cli_hosts where id=host) is not null then raise exception 'Stopped slot retained';end if;
 if has_function_privilege('anon','public.cli_onboarding_user_action(uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.cli_onboarding_worker_action(uuid,text,jsonb)','EXECUTE') or has_table_privilege('authenticated','private.cli_login_envelopes','SELECT') then raise exception 'Login data exposed';end if;
end $$;
rollback;
