// SDK search results contain display text (sometimes highlighted/abbreviated)
// and the canonical originalText used by the address index. Never infer a
// property from a street, settlement, parcel, or the first ambiguous result.
export function govMapAddressSuggestions(response:unknown):string[]{
 const envelope=response as {data?:unknown;results?:unknown;errorCode?:unknown;status?:unknown}|null;
 if(!envelope||typeof envelope!=='object')throw new Error('Invalid GovMap search response');
 if((envelope.errorCode!=null&&Number(envelope.errorCode)!==0)||(envelope.status!=null&&Number(envelope.status)!==0))throw new Error('GovMap search failed');
 const data=(envelope.data??envelope) as {results?:unknown};
 if(!Array.isArray(data?.results))throw new Error('Invalid GovMap search results');
 const labels=new Set<string>();
 for(const item of data.results){
  if(!item||item.type!=='address')continue;
  const label=item.originalText??item.text;
  if(typeof label==='string'&&label.trim().length>=3&&label.length<=500&&!/[<>]/.test(label)&&![...label].some(char=>char.charCodeAt(0)<32))labels.add(label.trim());
  if(labels.size===8)break;
 }
 return [...labels];
}
