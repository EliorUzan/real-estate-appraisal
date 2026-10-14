import {useEffect,useState} from 'react';
import {onboarding,type OnboardingStatus} from './cli-onboarding';
import type {CliProvider} from './cli-status';

// A provider's connection identity must never be borrowed from another provider.
export function useCliProviderHost(provider:CliProvider,active=true){
 const [value,setValue]=useState<{provider:CliProvider;status:OnboardingStatus}|null>(null);
 useEffect(()=>{
  if(!active||provider==='openai')return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{const status=await onboarding.status(controller.signal,provider);if(!controller.signal.aborted)setValue({provider,status});}
   catch{if(!controller.signal.aborted)setValue(null);}
   finally{if(!controller.signal.aborted)timer=setTimeout(poll,10000);}
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[active,provider]);
 return active&&value?.provider===provider?value.status:null;
}
