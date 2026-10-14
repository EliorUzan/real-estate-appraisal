import type { CliProviderStatus } from '../lib/cli-status';
import {useState} from 'react';
import {useCliProviderHost} from '../lib/use-cli-provider-host';
import {onboarding} from '../lib/cli-onboarding';
import {onboardingMessage} from '../../../supabase/functions/cli-onboarding/messages.ts';

export function CliHostNotice({provider}:{provider:CliProviderStatus|undefined}) {
  const status=useCliProviderHost(provider?.provider??'gemini',provider?.connection?.status==='connected');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if (provider?.reason !== 'PERSONAL_EXPERIMENT' || provider.connection?.status !== 'connected') return null;
  const wake=status?.wake;
  const starting=wake?.state==='requested'||wake?.state==='starting';
  const recovery=['draining','quarantined'].includes(status?.hostState??'');
  async function start(){
    if(!provider||busy)return;setBusy(true);setError('');
    try{await onboarding.wake(crypto.randomUUID(),provider.provider);}
    catch(e){setError(e instanceof Error?e.message:'לא ניתן להפעיל את שרת הסוכן.');}
    finally{setBusy(false);}
  }
  return <div><p className="muted" role="status">{provider.connection.available
    ? 'שרת הניסוי פועל ונכבה כשאינו בשימוש. החשבון והתוצאות נשמרים גם כשהשרת כבוי.'
    : recovery?'השרת דורש טיפול של מנהל המערכת לפני חידוש העבודה. החשבון נשאר שמור.'
    : starting?'שרת הסוכן עולה. אין צורך לפתוח חלון נוסף או להיכנס שוב לחשבון.'
    : wake?.configured?'החשבון מחובר והשרת במנוחה. לחיצה על שליחה תפעיל את השרת ותעביר את הבקשה כשהוא מוכן.'
    : 'החשבון מחובר. הפעלה אוטומטית של השרת ממתינה להשלמת הגדרה חד־פעמית בידי מנהל המערכת.'}</p>
    {!provider.connection.available&&wake?.configured&&<button type="button" className="secondary" disabled={busy||starting||status?.hostState!=='asleep'} onClick={()=>void start()}>הפעלת שרת הסוכן</button>}
    {!provider.connection.available&&wake?.state==='failed'&&<p className="error" role="alert">{onboardingMessage(wake.errorCode??'HOST_START_FAILED')}</p>}
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
