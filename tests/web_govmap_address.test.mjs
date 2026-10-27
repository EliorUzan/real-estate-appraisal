import {test} from 'node:test';
import assert from 'node:assert/strict';
import {govMapAddressSuggestions} from '../web/src/lib/govmap-address.ts';

test('GovMap suggestions prefer the canonical address and exclude street/parcel results',()=>{
 // Shape observed in GovMap's public search response on 27 October 2026.
 const address={id:'address|ADDR|74239389|דוד מרכוס|20|יהוד',type:'address',text:'דוד מרכוס 20 יהוד',originalText:'דוד מרכוס 20 יהוד-מונוסון'};
 assert.deepEqual(govMapAddressSuggestions({results:[address,{...address,text:'duplicate'},
  {type:'street',text:'דוד מרכוס יהוד'},{type:'parcel',text:'גוש 6685 חלקה 154'},
  {type:'address',text:'התחייה 2 חדרה'},null,{type:'address',text:'<b>unsafe</b>'}]}),[address.originalText,'התחייה 2 חדרה']);
 assert.deepEqual(govMapAddressSuggestions({data:{results:[]}}),[]);
 for(const response of [null,{}, {status:403,results:[]},{errorCode:1,results:[]},{results:'bad'}])assert.throws(()=>govMapAddressSuggestions(response));
});

test('GovMap labels are bounded plain text, never HTML or control characters',()=>{
 const rows=['x'.repeat(501),'valid\naddress','<img src=x>','',...Array.from({length:12},(_,i)=>`כתובת ${i}`)].map(text=>({type:'address',text}));
 assert.equal(govMapAddressSuggestions({results:rows}).length,8);
 assert.equal(govMapAddressSuggestions({results:rows})[0],'כתובת 0');
});
