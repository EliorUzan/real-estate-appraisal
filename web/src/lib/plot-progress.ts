export function plotProgress(mode:'api'|'cli',phase:string){
 const stages=mode==='cli'?['נתוני GovMap','הכנה ושליחה','בתור','הסוכן עובד','התיאור מוכן']:['נתוני GovMap','יצירת תיאור ב־AI','התיאור מוכן'];
 const indices:Record<string,number>=mode==='cli'?{collecting:0,waking:1,sending:1,queued:2,running:3,succeeded:4}:{collecting:0,running:1,succeeded:2};
 const current=indices[phase];
 return current===undefined?null:{stages,current,complete:phase==='succeeded'};
}
