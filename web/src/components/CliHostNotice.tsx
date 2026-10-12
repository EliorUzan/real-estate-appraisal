import type { CliProviderStatus } from '../lib/cli-status';
import {useCliConnectionController} from '../lib/cli-connection-context';
import {onboardingMessage} from '../../../supabase/functions/cli-onboarding/messages.ts';

export function CliHostNotice({provider}:{provider:CliProviderStatus|undefined}) {
  const onboarding=useCliConnectionController();
  if (provider?.reason !== 'PERSONAL_EXPERIMENT' || provider.connection?.status !== 'connected') return null;
  const wake=onboarding?.status?.wake;
  const starting=wake?.state==='requested'||wake?.state==='starting';
  const recovery=['draining','quarantined'].includes(onboarding?.status?.hostState??'');
  return <div><p className="muted" role="status">{provider.connection.available
    ? 'שרת הניסוי פועל ונכבה כשאינו בשימוש. החשבון והתוצאות נשמרים גם כשהשרת כבוי.'
    : recovery?'השרת דורש טיפול של מנהל המערכת לפני חידוש העבודה. החשבון נשאר שמור.'
    : starting?'שרת הסוכן עולה. אין צורך לפתוח חלון נוסף או להיכנס שוב ל-Google.'
    : wake?.configured?'החשבון מחובר והשרת במנוחה. לחיצה על שליחה תפעיל את השרת ותעביר את הבקשה כשהוא מוכן.'
    : 'החשבון מחובר. הפעלה אוטומטית של השרת ממתינה להשלמת הגדרה חד־פעמית בידי מנהל המערכת.'}</p>
    {!provider.connection.available&&wake?.configured&&<button type="button" className="secondary" disabled={onboarding?.busy||starting||onboarding?.status?.hostState!=='asleep'} onClick={()=>void onboarding?.wake()}>הפעלת שרת הסוכן</button>}
    {!provider.connection.available&&wake?.state==='failed'&&<p className="error" role="alert">{onboardingMessage(wake.errorCode??'HOST_START_FAILED')}</p>}
    {onboarding?.error&&<p className="error" role="alert">{onboarding.error}</p>}
  </div>;
}
