"""Local-only bridge invoked by Vite. Credentials never leave via stdout."""
import json
import sys
import urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".venv" / "Lib" / "site-packages"))
from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore, PROVIDERS
def main():
    payload=json.loads(sys.stdin.read(12000))
    token=payload["token"]
    store=ProviderSettingsStore()
    imported=[]
    failed=[]
    for provider, definition in PROVIDERS.items():
        key,model=store.load(provider)
        if not key:
            continue
        data=json.dumps({"action":"saveProvider","provider":provider,"model":model or definition.model_options[0][1],"key":key}).encode()
        request=urllib.request.Request("https://cdgjvtzxfpguqetpljae.supabase.co/functions/v1/appraisal",data=data,headers={"Authorization":"Bearer "+token,"apikey":"sb_publishable_a40CSBcrR3_B_wff8DQANg_hI8r2BsL","Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(request,timeout=30) as response:
                result=json.load(response)
                if result.get("configured"):
                    imported.append(provider)
                else:
                    failed.append(provider)
        except Exception:
            failed.append(provider)
    print(json.dumps({"imported":imported,"failed":failed}))
if __name__=="__main__":
    try: main()
    except Exception:
        print(json.dumps({"error":"Desktop import could not run. Verify the desktop Python environment."}))
        sys.exit(1)

