import {useEffect,useState} from 'react';
import type {CliProvider} from './cli-agent';
import {useCliConnections} from './use-cli-connections';
import {useCliConnectionController} from './cli-connection-context';
import {canSubmitCli} from './cli-status';
import {canWakeForPrompt} from './cli-host-ready';

export function useCliAccount(active=true){
 const [provider,setProvider]=useState<CliProvider>('gemini');
 const connections=useCliConnections(active),onboarding=useCliConnectionController();
 const firstUse=onboarding?.firstUse;
 useEffect(()=>{if(active&&provider==='gemini'&&connections.verified&&!connections.loading)firstUse?.();},[active,provider,connections.verified,connections.loading,firstUse]);
 const selected=connections.providers.find(p=>p.provider===provider);
 const ready=canSubmitCli(selected,connections.verified),wakeAllowed=canWakeForPrompt(selected,onboarding?.status??null,connections.verified);
 const issue=connections.loading?'בודק את זמינות חשבון CLI. נסו שוב בעוד רגע.':!connections.verified?'לא ניתן לאמת את חשבון CLI. רעננו זמינות.':!selected?.connection||selected.connection.status!=='connected'?'יש לחבר חשבון CLI בהגדרות.':!ready&&!wakeAllowed?'חשבון CLI או שרת הסוכן אינם זמינים. בדקו את מצב החיבור בהגדרות.':'';
 return {...connections,provider,setProvider,selected,ready,wakeAllowed,issue};
}
