import {CLI_MODELS,type CliModel} from '../../../supabase/functions/appraisal/cli-models';
import type {useCliAccount} from '../lib/use-cli-account';

export function CliModelControl({account}:{account:ReturnType<typeof useCliAccount>}){
 if(account.provider!=='claude')return <p className='muted'>מודל ברירת המחדל של חשבון CLI שנבחר.</p>;
 return <><label>מודל Claude ורמת מאמץ<select value={account.modelSelection} onChange={e=>account.setModelSelection(e.target.value as CliModel)}>{CLI_MODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
  <small>Haiku במאמץ נמוך מתאים לבדיקות קלות. זמינות המודלים והשימוש במכסה כפופים לחשבון Claude.</small></>;
}
