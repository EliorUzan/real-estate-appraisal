import {RequestProgress} from './CliActivity';
import {plotProgress} from '../lib/plot-progress';

export function PlotProgress({mode,phase}:{mode:'api'|'cli';phase:string}){
 const progress=plotProgress(mode,phase);
 return progress?<RequestProgress {...progress} label="שלבי יצירת תיאור החלקה"/>:null;
}
