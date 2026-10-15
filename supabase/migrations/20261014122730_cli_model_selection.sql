-- Preserve all existing ownership, lease, onboarding and idempotency checks.
-- Assertions fail closed if the prerequisite function definitions have changed.
do $migration$
declare source text; old text; replacement text;
begin
 source:=pg_get_functiondef('public.cli_user_action(uuid,text,jsonb)'::regprocedure);
 old:='if c.status<>''connected'' then raise exception ''CONNECTION_CHANGED''; end if;';
 replacement:=old||E'\n'||$patch$
 if coalesce(p_body->>'modelSelection','provider-default') not in ('provider-default','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5')
   or (coalesce(p_body->>'modelSelection','provider-default')<>'provider-default' and c.provider_id<>'claude') then
   raise exception 'UNSUPPORTED_CAPABILITY';
 end if;
$patch$;
 if position(old in source)=0 then raise exception 'Model validation patch prerequisite missing';end if;
 source:=replace(source,old,replacement);
 old:='end,''cli-default'',null,p_body->>''payloadDigest''';
 replacement:='end,case when coalesce(p_body->>''modelSelection'',''provider-default'')=''provider-default'' then ''cli-default'' else p_body->>''modelSelection'' end,null,p_body->>''payloadDigest''';
 if position(old in source)=0 then raise exception 'Model persistence patch prerequisite missing';end if;
 execute replace(source,old,replacement);

 source:=pg_get_functiondef('private.cli_job_view(uuid)'::regprocedure);
 old:='''modelRequested'',''provider-default''';
 if position(old in source)=0 then raise exception 'Model presentation patch prerequisite missing';end if;
 execute replace(source,old,'''modelRequested'',case when j.model_id=''cli-default'' then ''provider-default'' else j.model_id end');

 source:=pg_get_functiondef('public.cli_worker_action(uuid,text,jsonb)'::regprocedure);
 old:='return v_result;';
 replacement:=$patch$
 if p_action='claim' and v_result->'job'->>'phase'='claimed' and coalesce((v_result->'job'->>'recoveryRequired')::boolean,false)=false then
   v_result:=jsonb_set(v_result,'{job,modelSelection}',to_jsonb((select case when model_id='cli-default' then 'provider-default' else model_id end
     from public.generation_jobs where id=(v_result->'job'->>'jobId')::uuid)));
 end if;
 return v_result;
$patch$;
 if position(old in source)=0 then raise exception 'Model claim patch prerequisite missing';end if;
 execute replace(source,old,replacement);
end $migration$;
