import type {useCliSubmission} from '../lib/use-cli-submission';
import {CliJobStatus} from './CliJobStatus';
import {CliActivity,CliProgress} from './CliActivity';
export function CliSubmissionStatus({run}:{run:ReturnType<typeof useCliSubmission>}){
 return <>{run.busy&&!run.identity?.jobId&&<><CliActivity active>{run.waking?'מפעילים את שרת הסוכן. הבקשה עדיין לא הועברה לסוכן…':'בודקים זמינות ושולחים את הבקשה לסוכן…'}</CliActivity><CliProgress status={run.waking?'waking':'sending'}/>{run.waking&&<button type='button' className='secondary' onClick={run.cancelWake}>ביטול לפני שליחה</button>}</>}
  {run.identity?.jobId&&<CliJobStatus key={run.identity.jobId} jobId={run.identity.jobId} initial={run.job} onTerminal={run.markTerminal}/>}
  {run.identity&&!run.identity.jobId&&<p role='status'>{run.identity.rejection?'הבקשה לא התקבלה להפעלה. מזהה ניסיון השליחה: ':'מזהה הבקשה נשמר לצורך איתור התוצאה: '}<bdi>{run.identity.requestId}</bdi></p>}
  {run.canRetry&&<button type='button' disabled={run.busy} onClick={()=>void run.retry()}>ניסיון נוסף עם אותה בקשה</button>}
  {run.done&&<button type='button' className='secondary' disabled={run.busy} onClick={run.reset}>יצירת בקשה חדשה</button>}
  {run.error&&<p role='alert' className='error'>{run.error}</p>}</>;
}
