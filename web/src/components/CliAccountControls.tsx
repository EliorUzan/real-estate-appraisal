import {cliLabels,type CliProvider} from '../lib/cli-agent';
import {connectionLabel,connectionHelp} from '../lib/cli-status';
import type {useCliAccount} from '../lib/use-cli-account';
import {CliHostNotice} from './CliHostNotice';

export function CliAccountControls({account,onSettings}:{account:ReturnType<typeof useCliAccount>;onSettings:()=>void}){
 return <><div className='actions'><button type='button' className='secondary' onClick={onSettings}>ניהול חשבונות CLI</button><button type='button' className='secondary' disabled={account.loading} onClick={account.refresh}>רענון זמינות</button></div>
  <label>חשבון CLI<select value={account.provider} onChange={e=>account.setProvider(e.target.value as CliProvider)}>{account.providers.map(p=><option key={p.provider} value={p.provider}>{cliLabels[p.provider]} · {account.loading?'בודק מצב…':connectionLabel(p)}</option>)}</select></label>
  {account.selected&&<p role='status' className='muted'>{connectionHelp(account.selected)}</p>}
  {account.error&&<p role='alert' className='error'>{account.error}</p>}
  {account.verified&&!account.loading&&<CliHostNotice provider={account.selected}/>}</>;
}
