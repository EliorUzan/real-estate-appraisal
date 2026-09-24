import { useEffect, useRef } from "react";
import type { PlotAnalysisData } from "../lib/plot-description";

export function GovMapPanel({ address, mode = "map", onPlotData }: { address: string; mode?: "map" | "plot"; onPlotData?:(data:PlotAnalysisData|null)=>void }) {
  const frame=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin || event.source!==frame.current?.contentWindow || mode!=="plot")return;
      if(event.data?.type==="plot-evidence" && event.data.address===address)onPlotData?.(event.data.data);
    };
    window.addEventListener("message",receive);
    return ()=>window.removeEventListener("message",receive);
  },[address,mode,onPlotData]);
  // A separate same-origin document isolates each SDK instance (including history
  // reports) and tears down its message listeners when React removes the frame.
  // The fragment keeps the address out of hosting request logs and referrers.
  return <section className="govmap-panel" aria-label={mode === "plot" ? "תיאור החלקה ומפת GovMap" : "מפת הנכס וגוש וחלקה"}>
    <iframe
      ref={frame}
      key={`${mode}:${address}`}
      className={`govmap-frame${mode === "plot" ? " plot-frame" : ""}`}
      title={`${mode === "plot" ? "תיאור החלקה ומפת GovMap" : "מפת GovMap וגוש וחלקה"} — ${address}`}
      src={`/govmap.html#${new URLSearchParams({ address, mode })}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </section>;
}
