export function CollapsibleTextarea({label,rows,value,onChange}:{label:string;rows:number;value:string;onChange:(value:string)=>void}){
  return <details className="optional-text-field">
    <summary>{label}<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
    <textarea aria-label={label} rows={rows} maxLength={20000} value={value} onChange={event=>onChange(event.target.value)}/>
  </details>;
}
