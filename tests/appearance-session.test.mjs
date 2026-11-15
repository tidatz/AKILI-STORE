import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/appearance.js',import.meta.url),'utf8');
const storage=values=>{const map=new Map(Object.entries(values||{}));return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function browser({local=storage(),session=storage(),initial={design:'classic',mode:'light'}}={}){
 let now=1000000,server=initial,interval;const listeners={},root={dataset:{},style:{setProperty(){}}};
 const document={documentElement:root,hidden:false,addEventListener:(e,cb)=>listeners[e]=cb};
 const window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener:(e,cb)=>listeners[e]=cb};
 const context=vm.createContext({window,document,localStorage:local,sessionStorage:session,Date:{now:()=>now},setInterval:cb=>{interval=cb;},fetch:async()=>({ok:true,json:async()=>({appearance:server,primary_color:'#1D4ED8'})})});vm.runInContext(source,context);
 return {api:window.akiliAppearance,root,local,session,advance:ms=>now+=ms,interval:()=>interval(),event:e=>listeners[e]?.(),server:v=>server=v,settle:()=>new Promise(r=>setImmediate(r))};
}
test('old permanent personal choices no longer override the administrator default',async()=>{
 const b=browser({local:storage({'akili-appearance':JSON.stringify({design:'glass',mode:'dark'})})});await b.settle();assert.equal(b.root.dataset.design,'classic');assert.equal(b.root.dataset.theme,'light');assert.equal(b.local.getItem('akili-appearance'),null);
});
test('temporary choices survive an active reload but expire after inactivity',async()=>{
 const b=browser();await b.settle();b.api.setPersonal({design:'soft',mode:'dark'});assert.equal(b.root.dataset.design,'soft');
 const reloaded=browser({local:b.local,session:b.session});await reloaded.settle();assert.equal(reloaded.root.dataset.design,'soft');reloaded.advance(31*60*1000);reloaded.api.apply();assert.equal(reloaded.root.dataset.design,'classic');assert.equal(reloaded.root.dataset.theme,'light');
});
test('a new browser session uses the admin choice even when another session had a personal theme',async()=>{
 const b=browser();await b.settle();b.api.setPersonal({design:'glass',mode:'dark'});const next=browser({local:b.local});await next.settle();assert.equal(next.root.dataset.design,'classic');
});
test('admin changes reach active visitors and become the fallback after temporary choices expire',async()=>{
 const b=browser();await b.settle();b.server({design:'illustrative',mode:'dark'});await b.api.refresh();assert.equal(b.root.dataset.design,'illustrative');b.api.setPersonal({design:'glass',mode:'light'});b.server({design:'monochrome',mode:'dark'});await b.api.refresh();assert.equal(b.root.dataset.design,'glass');b.advance(31*60*1000);b.api.apply();assert.equal(b.root.dataset.design,'monochrome');assert.equal(b.root.dataset.theme,'dark');
});
test('activity extends the temporary session while expired sessions cannot revive it',async()=>{
 const b=browser();await b.settle();b.api.setPersonal({design:'glass',mode:'dark'});b.advance(20*60*1000);b.event('pointerdown');b.advance(20*60*1000);b.api.apply();assert.equal(b.root.dataset.design,'glass');b.advance(31*60*1000);b.event('pointerdown');b.api.apply();assert.equal(b.root.dataset.design,'classic');
});
