import {useCallback,useEffect,useRef,useState} from 'react';
import type {PlotAnalysisData} from './plot-description';
import {createPlotCollection} from './plot-collection';

export function useGovMapCollection(active=true){
 const [collector]=useState(()=>createPlotCollection());
 const enabled=useRef(active);
 const [address,setAddress]=useState(''),[version,setVersion]=useState(0),[data,setData]=useState<PlotAnalysisData|null>(null),[collecting,setCollecting]=useState(false);
 useEffect(()=>()=>{enabled.current=false;collector.cancel('איסוף נתוני המפה בוטל.');},[collector]);
 useEffect(()=>{enabled.current=active;if(!active)collector.cancel('איסוף נתוני המפה בוטל במעבר לעמוד אחר.');},[active,collector]);
 const receive=useCallback((value:PlotAnalysisData|null)=>{setData(value);collector.receive(value);},[collector]);
 const lookup=useCallback((value:string)=>{setData(null);setAddress(value);setVersion(v=>v+1);},[]);
 const collect=useCallback(async(value:string)=>{
  if(!enabled.current)throw new Error('איסוף נתוני המפה בוטל במעבר לעמוד אחר.');
  setCollecting(true);
  const result=collector.start(value);
  lookup(value);
  try{return await result;}finally{setCollecting(false);}
 },[collector,lookup]);
 return {address,version,data,collecting,lookup,collect,receive,cancel:collector.cancel};
}
