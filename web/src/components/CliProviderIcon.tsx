import type {CliProvider} from '../lib/cli-agent';
import {Icon} from './ProviderControls';

export function CliProviderIcon({provider}:{provider:CliProvider}){
 if(provider==='gemini')return <svg className="provider-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M4 23 12 5a2.2 2.2 0 0 1 4 0l8 18" stroke="#4285f4" strokeWidth="4" strokeLinecap="round"/><path d="M9 19q5-6 10 0" stroke="#a142f4" strokeWidth="3" strokeLinecap="round"/></svg>;
 return <Icon provider={provider==='claude'?'anthropic':'openai'}/>;
}
