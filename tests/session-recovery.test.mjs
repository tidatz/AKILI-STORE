import test from 'node:test';
import assert from 'node:assert/strict';
import {api,session} from '../public/auth.js';

async function fixture(run,{failure=null,status=400}={}){
 const names=['sessionStorage','fetch'],previous=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const stored=new Map([['akili-session',JSON.stringify({access_token:'old-unit-token',refresh_token:'unit-refresh',expires_at:Date.now()-1000})],['akili-checkout','saved-purchase']]),calls=[];
 Object.defineProperties(globalThis,{
  sessionStorage:{configurable:true,value:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v)),removeItem:k=>stored.delete(k)}},
  fetch:{configurable:true,value:async(url,opts={})=>{
   calls.push({url,headers:opts.headers});
   const reply=(data,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json'}});
   if(String(url).includes('action=config'))return reply({supabase_url:'https://database.test',publishable_key:'public-unit-test'});
   if(String(url).includes('grant_type=refresh_token')){
    if(failure==='network')throw Error('Connection failed');
    if(failure)return reply({message:'Provider detail that should not reach the UI'},status);
    return reply({access_token:'new-unit-token',refresh_token:'new-unit-refresh',expires_in:3600});
   }
   return reply({ok:true});
  }}
 });
 try{await run({stored,calls});}finally{for(const k of names){const d=previous.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
}

test('an invalid refresh session becomes a clean sign-in requirement without losing the checkout',async()=>fixture(async({stored,calls})=>{
 await assert.rejects(api('market-me'),e=>e.status===401&&e.message==='Muda wa kuingia umeisha. Ingia tena.');
 assert.equal(session(),null);assert.equal(stored.get('akili-checkout'),'saved-purchase');
 assert.equal(calls.some(c=>c.url.includes('action=market-me')),false);
},{failure:'revoked'}));

test('temporary network, provider and rate-limit failures preserve the session for retry',async()=>{
 for(const options of [{failure:'network'},{failure:'unavailable',status:503},{failure:'rate-limited',status:429}]){
  await fixture(async({stored})=>{
   await assert.rejects(api('market-me'),e=>e.status!==401&&e.message==='Huduma ya akaunti haijapatikana. Jaribu tena.');
   assert.equal(session().refresh_token,'unit-refresh');assert.equal(stored.get('akili-checkout'),'saved-purchase');
  },options);
 }
});

test('concurrent private requests refresh once and use the new access token',async()=>fixture(async({calls})=>{
 const results=await Promise.all([api('market-me'),api('market-orders')]);assert.ok(results.every(r=>r.ok));
 assert.equal(calls.filter(c=>c.url.includes('grant_type=refresh_token')).length,1);
 for(const call of calls.filter(c=>/action=market-(me|orders)/.test(c.url)))assert.equal(call.headers.Authorization,'Bearer new-unit-token');
 assert.equal(session().refresh_token,'new-unit-refresh');
}));
