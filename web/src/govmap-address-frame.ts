import {loadGovMap,withTimeout} from './lib/govmap';
import {govMapAddressSuggestions} from './lib/govmap-address';

const query=new URLSearchParams(location.hash.slice(1)).get('query')?.trim()??'';
const token=import.meta.env.VITE_GOVMAP_TOKEN?.trim()||'e7ae87c1-eccb-4410-9c28-17994e01f72a';
async function suggest(){
 if(query.length<3||query.length>500)return;
 try{
  // search is a standalone SDK method: it needs the domain's public token,
  // but does not need createMap/geocode or a rendered map. Isolate its shared
  // debouncer from the cadastral searches in the other GovMap frames.
  const api=await loadGovMap();
  const response=await withTimeout(api.search({searchText:query,apiKey:token,language:'he',maxResults:8,isAccurate:false,layers:['address']}),12000);
  window.parent.postMessage({type:'govmap-address-results',query,labels:govMapAddressSuggestions(response)},location.origin);
 }catch{
  window.parent.postMessage({type:'govmap-address-results',query,error:true},location.origin);
 }
}
void suggest();
