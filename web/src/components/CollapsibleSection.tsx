import type {ReactNode} from 'react';

export function CollapsibleSection({label,children}:{label:string;children:ReactNode}){
 return <details className="optional-text-field">
  <summary>{label}<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
  <div className="collapsible-section-content">{children}</div>
 </details>;
}
