import {useId} from 'react';

export function ExecutionModeControl({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const group=useId();
 return <fieldset className="icon-choices"><legend>אופן הפעלה</legend><div className="icon-choice-options">
  {(['api','cli'] as const).map(mode=><label className="icon-choice" key={mode}>
   <input type="radio" name={group} value={mode} checked={value===mode} onChange={()=>onChange(mode)}/>
   <svg className="provider-icon" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mode==='cli'?<><rect x="3" y="5" width="22" height="18" rx="3"/><path d="m7 11 4 3-4 3m8 0h5"/></>:<><path d="m10 8-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/></>}</svg>
   <span><bdi>{mode.toUpperCase()}</bdi>{mode==='cli'?' · חשבון אישי':''}</span>
  </label>)}
 </div></fieldset>;
}
