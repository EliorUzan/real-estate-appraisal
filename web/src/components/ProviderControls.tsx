import catalog from "../catalog.json";

export function Icon({provider}:{provider:string}) {
  if(provider==="openai" || provider==="gemini" || provider==="groq")return <img className="provider-icon" alt={provider==="openai"?"ChatGPT":provider==="groq"?"Groq":"Gemini"} src={"/icons/"+(provider==="openai"?"chatgpt":provider)+".svg"}/>;
  return <span className={"provider-icon monogram "+provider} aria-hidden="true">{provider==="anthropic"?"✳":provider==="moonshot"?"K":"Q"}</span>;
}

export function Models({provider,value,onChange,label="מזהה מודל"}:{provider:string;value:string;onChange:(v:string)=>void;label?:string}) {
  const models=catalog.providers.find(p=>p.id===provider)?.models??[];
  return <label>{label}<select aria-label={label==="מזהה מודל"?"בחירת מודל":label} dir="ltr" value={models.some(m=>m[1]===value)?value:"custom"} onChange={e=>onChange(e.target.value==="custom"?"":e.target.value)}>
    {models.map(([label,id])=><option key={id} value={id}>{label}</option>)}<option value="custom">מודל אחר…</option>
  </select><input aria-label="מזהה מודל" dir="ltr" value={value} maxLength={160} onChange={e=>onChange(e.target.value)} required/><small>הזמינות תלויה בחשבון הספק. אפשר לבחור מודל מהרשימה או להזין מזהה אחר.</small></label>;
}
