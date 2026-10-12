import { useEffect,useState,useContext,useCallback } from "react";
import { CliConnectionContext } from "./cli-connection-context";
import { cli } from "./cli-agent";
import { providerCatalog,type CliProviderStatus } from "./cli-status";

export function useCliConnections(active = true) {
  const shared=useContext(CliConnectionContext);
  const [statuses,setStatuses] = useState<CliProviderStatus[]>([]);
  const [loading,setLoading] = useState(true), [verified,setVerified] = useState(false);
  const [error,setError] = useState(""), [revision,setRevision] = useState(0);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(() => {
    if (!active||shared) return;
    const controller = new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined, inFlight = false;
    async function load() {
      if (inFlight || controller.signal.aborted || document.hidden) return;
      inFlight = true;
      try {
        const result = await cli.connections(controller.signal);
        if (controller.signal.aborted) return;
        setStatuses(result.providers ?? []); setVerified(true); setError("");
      } catch (e) {
        if (!controller.signal.aborted) {
          setVerified(false);
          setError(e instanceof Error ? e.message : "טעינת מצב חשבונות CLI נכשלה");
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(false); timer = setTimeout(load, 15000);
        }
      }
    }
    function resume() { if (timer) clearTimeout(timer); void load(); }
    setLoading(true); setVerified(false);
    void load();
    document.addEventListener("visibilitychange",resume);
    window.addEventListener("online",resume);
    return () => {
      controller.abort(); if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange",resume); window.removeEventListener("online",resume);
    };
  }, [active,revision,shared]);
  if(shared)return shared.connections;
  return {providers:providerCatalog(statuses),loading,verified,error,refresh};
}
