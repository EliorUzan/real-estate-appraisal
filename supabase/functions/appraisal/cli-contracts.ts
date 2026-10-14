export const CLI_ACTIONS = new Set(["listCliConnections","requestCliConnection","disconnectCliConnection","createCliJob","getCliJob","lookupCliJob","cancelCliJob"]);
export const LIMIT = 262144;
export const MAX_CLI_BODY = 1500000;
export const CLI_SECTIONS = ['environment_description','plot_description','comparable_sales'] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const status:Record<string,number>={INSUFFICIENT_COMPARABLES:422,UNAUTHENTICATED:401,INACTIVE_MEMBERSHIP:403,NOT_FOUND:404,REQUEST_ID_CONFLICT:409,CONNECTION_CHANGED:409,PROMPT_CHANGED:409,RESULT_EXPIRED:410,INPUT_TOO_LARGE:413,UNSUPPORTED_CAPABILITY:422,INVALID_INPUT:422,INVALID_OUTPUT:422,QUEUE_FULL:429,WORKER_UNAVAILABLE:503};
const messages:Record<string,string>={INSUFFICIENT_COMPARABLES:"נמצאו פחות משלוש עסקאות שעברו את סף הדמיון. לא הופעל Claude. אפשר להרחיב את התקופה או לבדוק את פרטי הנכס.",UNAUTHENTICATED:"יש להתחבר מחדש.",INACTIVE_MEMBERSHIP:"אין הרשאה פעילה לצוות.",NOT_FOUND:"הבקשה או החיבור לא נמצאו.",REQUEST_ID_CONFLICT:"מזהה הבקשה כבר שימש לתוכן אחר.",CONNECTION_CHANGED:"החיבור השתנה. יש לבדוק את מצבו לפני בקשה חדשה.",PROMPT_CHANGED:"הוראות הסוכן השתנו. נסו שוב.",RESULT_EXPIRED:"תוכן הבקשה הוסר לפי מדיניות השמירה.",INPUT_TOO_LARGE:"התוכן גדול מדי לשליחה.",UNSUPPORTED_CAPABILITY:"יכולת זו אינה זמינה במצב CLI.",INVALID_INPUT:"פרטי הבקשה אינם תקינים.",INVALID_OUTPUT:"לא התקבלה תשובה תקינה מהסוכן.",QUEUE_FULL:"תור הבקשות מלא. נסו שוב מאוחר יותר.",WORKER_UNAVAILABLE:"שרת CLI אינו זמין או טרם הוגדר.",AUTH_REQUIRED:"יש לחבר מחדש את חשבון הספק.",PLAN_REQUIRED:"החשבון אינו זכאי להפעלת הסוכן.",QUOTA_EXCEEDED:"מכסת הספק נוצלה.",TIMEOUT:"הסוכן חרג מזמן ההפעלה.",OUTPUT_LIMIT:"תשובת הסוכן חרגה ממגבלת הגודל.",CLI_FAILED:"הסוכן נכשל.",ACCESS_REVOKED:"ההרשאה לצוות בוטלה.",WORKER_LOST:"הקשר לשרת אבד.",OUTCOME_UNCERTAIN:"לא ניתן לקבוע את תוצאת ההפעלה. יש לבדוק לפני יצירת בקשה נוספת.",CANCELLED:"הבקשה בוטלה.",QUEUE_EXPIRED:"הבקשה פגה בתור."};
export class CliProblem extends Error {
  status:number;
  code:string;
  constructor(code:string){super(messages[code]??"פעולת CLI לא הושלמה.");this.code=code;this.status=status[code]??500;}
}
export function errorBody(error:unknown,requestId?:string){
  const problem=error instanceof CliProblem?error:new CliProblem("INTERNAL_ERROR");
  return {error:{code:problem.code,message:problem.message,retryable:["QUEUE_FULL","WORKER_UNAVAILABLE","PROMPT_CHANGED"].includes(problem.code)},requestId};
}
export function requireThat(ok:unknown,code="INVALID_INPUT"):asserts ok {if(!ok)throw new CliProblem(code);}
export function strictKeys(body:Record<string,unknown>,keys:string[]){
  requireThat(body && typeof body==="object" && !Array.isArray(body));
  requireThat(Object.keys(body).every(k=>keys.includes(k)),"UNSUPPORTED_CAPABILITY");
  requireThat(keys.every(k=>k in body));
}
export function uuid(value:unknown){requireThat(typeof value==="string"&&UUID.test(value));return value;}
export function text(value:unknown,max:number,nonblank=false){
  requireThat(typeof value==="string"&&Array.from(value).length<=max&&(!nonblank||value.trim().length>0));
  requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
  return value;
}
export function validateUser(body:Record<string,unknown>,size:number){
  requireThat(size<=(body.sectionId==='plot_description'||body.sectionId==='comparable_sales'?MAX_CLI_BODY:LIMIT),"INPUT_TOO_LARGE");
  const action=body.action;
  requireThat(typeof action==="string"&&CLI_ACTIONS.has(action));
  if(action==="listCliConnections")strictKeys(body,["action"]);
  else if(action==="requestCliConnection"){
    strictKeys(body,["action","schemaVersion","provider"]);requireThat(body.schemaVersion===1);
    requireThat(["claude","openai","gemini"].includes(String(body.provider)));
  }else if(action==="disconnectCliConnection") {strictKeys(body,["action","connectionId"]);uuid(body.connectionId);}
  else if(action==="lookupCliJob") {strictKeys(body,["action","requestId"]);uuid(body.requestId);}
  else if(action==="getCliJob"||action==="cancelCliJob") {strictKeys(body,["action","jobId"]);uuid(body.jobId);}
  else {
    const keys=["action","schemaVersion","requestId","connectionId","workspaceId","sectionId","address","example","additionalRequest","modelSelection","consent"];
    strictKeys(body,'evidence' in body?[...keys,'evidence']:keys);
    requireThat(body.schemaVersion===1);uuid(body.requestId);uuid(body.connectionId);uuid(body.workspaceId);
    requireThat(CLI_SECTIONS.includes(body.sectionId as typeof CLI_SECTIONS[number])&&body.modelSelection==="provider-default","UNSUPPORTED_CAPABILITY");
    requireThat(body.consent===true);text(body.address,500,true);text(body.example,20000);text(body.additionalRequest,20000);
    if(body.sectionId==='environment_description')requireThat(body.evidence===undefined,'UNSUPPORTED_CAPABILITY');
    else requireThat(body.evidence!==null&&typeof body.evidence==='object'&&!Array.isArray(body.evidence));
  }
  return action;
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");}
export function clientIntent(b:Record<string,unknown>){return JSON.stringify({schemaVersion:1,requestId:b.requestId,connectionId:b.connectionId,workspaceId:b.workspaceId,sectionId:b.sectionId,address:b.address,example:b.example,additionalRequest:b.additionalRequest,modelSelection:b.modelSelection,consent:b.consent,...(b.evidence===undefined?{}:{evidence:b.evidence})});}
export function dbProblem(error:{message?:string}|null){if(error){const code=Object.keys({...status,INTERNAL_ERROR:500}).find(c=>error.message===c);throw new CliProblem(code??"INTERNAL_ERROR");}}
export function decorateJob<T extends {job?:{error?:{code:string;message?:string}}}>(data:T):T{if(data.job?.error)data.job.error.message=messages[data.job.error.code]??"הסוכן לא השלים את הבקשה.";return data;}
