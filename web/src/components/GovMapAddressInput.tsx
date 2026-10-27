import {useEffect,useId,useRef,useState} from 'react';

export function GovMapAddressInput({value,onChange,onSelect,active=true}:{value:string;onChange:(value:string)=>void;onSelect:(value:string)=>void;active?:boolean}){
 const id=useId(),frame=useRef<HTMLIFrameElement>(null);
 const [focused,setFocused]=useState(false),[dismissed,setDismissed]=useState(false),[query,setQuery]=useState(''),[highlight,setHighlight]=useState(-1);
 const [result,setResult]=useState<{query:string;labels:string[];failed?:boolean}|null>(null);
 const term=value.trim(),enabled=active&&focused&&!dismissed&&term.length>=3;
 useEffect(()=>{
  setQuery('');setResult(null);setHighlight(-1);
  if(!enabled)return;
  const timer=setTimeout(()=>setQuery(term),450);
  return ()=>clearTimeout(timer);
 },[term,enabled]);
 useEffect(()=>{
  if(!query)return;
  let finished=false;
  const timer=setTimeout(()=>{finished=true;setResult({query,labels:[],failed:true});},40000);
  const receive=(event:MessageEvent)=>{
   if(finished||event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='govmap-address-results'||event.data.query!==query)return;
   const labels:unknown=event.data.labels;
   if(!event.data.error&&(!Array.isArray(labels)||labels.length>8||!labels.every(v=>typeof v==='string'&&v.length<=500)))return;
   finished=true;clearTimeout(timer);
   setResult({query,labels:event.data.error?[]:labels as string[],failed:!!event.data.error});
  };
  window.addEventListener('message',receive);
  return ()=>{finished=true;clearTimeout(timer);window.removeEventListener('message',receive);};
 },[query]);
 const current=enabled&&query===term&&result?.query===term?result:null;
 const labels=current?.labels??[],open=labels.length>0;
 function select(label:string){setDismissed(true);setHighlight(-1);onSelect(label);}
 return <div className='govmap-address-input'>
  <label htmlFor={id}>כתובת הנכס (חובה)</label>
  <input id={id} required maxLength={500} value={value} autoComplete='off' role='combobox' aria-autocomplete='list'
   aria-expanded={open} aria-controls={open?`${id}-options`:undefined} aria-activedescendant={open&&highlight>=0?`${id}-option-${highlight}`:undefined} aria-describedby={`${id}-help`}
   onFocus={()=>{setFocused(true);setDismissed(false);}} onBlur={()=>setFocused(false)}
   onChange={e=>{setDismissed(false);setHighlight(-1);onChange(e.target.value);}}
   onKeyDown={e=>{
    if(e.nativeEvent.isComposing)return;
    if(e.key==='Escape'){setDismissed(true);setHighlight(-1);return;}
    if(open&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setHighlight(i=>e.key==='ArrowDown'?(i+1)%labels.length:(i<=0?labels.length-1:i-1));}
    if(open&&e.key==='Enter'&&highlight>=0){e.preventDefault();select(labels[highlight]);}
   }}/>
  {open&&<ul id={`${id}-options`} role='listbox' aria-label='כתובות מ־GovMap' className='govmap-address-options'>
   {labels.map((label,index)=><li id={`${id}-option-${index}`} key={label} role='option' aria-selected={highlight===index}
    onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setHighlight(index)} onClick={()=>select(label)}>{label}</li>)}
  </ul>}
  <p id={`${id}-help`} className='muted' role='status'>{current?.failed?'הצעות GovMap אינן זמינות. אפשר להמשיך עם הכתובת שהקלדתם.':current&&!open?'לא התקבלו הצעות כתובת. אין בכך אישור שהכתובת אינה קיימת; אפשר לנסות את כפתור הצגת המפה או להמשיך עם הכתובת שהקלדתם.':enabled&&!current?'מחפש כתובות ב־GovMap…':'הקלידו רחוב, מספר בית ויישוב. בחירת הצעה מעדכנת את הכתובת ומציגה את המפה; אפשר גם להשאיר כתובת חופשית.'}</p>
  {enabled&&query===term&&<iframe ref={frame} key={query} hidden title='חיפוש כתובות GovMap' src={`/govmap-address.html#${new URLSearchParams({query})}`} referrerPolicy='strict-origin-when-cross-origin'/>}
 </div>;
}
