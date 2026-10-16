import {useId} from 'react';
import {cliLabels} from '../lib/cli-agent';
import {connectionLabel,connectionHelp} from '../lib/cli-status';
import type {useCliAccount} from '../lib/use-cli-account';
import {CliModelControl} from './CliModelControl';
import {CliHostNotice} from './CliHostNotice';
import {CliActivity} from './CliActivity';
import {CliProviderIcon} from './CliProviderIcon';
import {CollapsibleSection} from './CollapsibleSection';

export function CliAccountControls({account,onSettings}:{account:ReturnType<typeof useCliAccount>;onSettings:()=>void}){
 const group=useId();
 return <><CollapsibleSection label="חשבון CLI ומודל"><div className='actions'><button type='button' className='secondary' onClick={onSettings}>ניהול חשבונות CLI</button><button type='button' className='secondary' disabled={account.loading} onClick={account.refresh}>רענון זמינות</button></div>
  <fieldset className="icon-choices"><legend>חשבון CLI</legend><div className="icon-choice-options">{account.providers.map(p=><label className="icon-choice" key={p.provider}><input type="radio" name={group} value={p.provider} checked={account.provider===p.provider} onChange={()=>account.setProvider(p.provider)}/><CliProviderIcon provider={p.provider}/><span><bdi>{cliLabels[p.provider]}</bdi><small>{account.loading?'בודק מצב…':connectionLabel(p)}</small></span></label>)}</div></fieldset>
  <CliModelControl account={account}/>
  </CollapsibleSection>
  {account.loading?<CliActivity active>בודקים זמינות של חשבונות CLI…</CliActivity>:account.selected&&<p role='status' className='muted'>{connectionHelp(account.selected)}</p>}
  {account.error&&<p role='alert' className='error'>{account.error}</p>}
  {account.verified&&!account.loading&&<CliHostNotice provider={account.selected}/>}</>;
}
