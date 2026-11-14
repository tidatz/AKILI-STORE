import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {callback,googleLogin,signout} from '../public/auth.js';

const target='/checkout/22222222-2222-4222-8222-222222222222?verify=1';
async function fixture(run){
 const names=['location','history','sessionStorage','fetch','crypto'];
 const previous=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),stored=new Map(),calls=[];
 const location={origin:'https://store.test',pathname:'/auth/callback',search:'',hash:'#access_token=unit-test-token&refresh_token=unit-test-refresh&expires_in=3600',assign:value=>calls.push({navigation:value})};
 Object.defineProperties(globalThis,{location:{configurable:true,value:location},history:{configurable:true,value:{replaceState:()=>{location.hash='';location.search='';}}},sessionStorage:{configurable:true,value:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v)),removeItem:k=>stored.delete(k)}},crypto:{configurable:true,value:webcrypto},fetch:{configurable:true,value:async(url,opts={})=>{calls.push({url,method:opts.method});return new Response(JSON.stringify(String(url).includes('action=config')?{supabase_url:'https://database.test',publishable_key:'public-test'}:{}),{status:200,headers:{'Content-Type':'application/json'}});}}});
 try{await run({stored,calls,location});}finally{for(const k of names){const d=previous.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
}
test('Google callback preserves the exact checkout query and consumes its return target once',async()=>fixture(async({stored,location})=>{
 stored.set('akili-next',target);const r=await callback();assert.equal(r.next,target);assert.equal(stored.has('akili-next'),false);assert.equal(location.hash,'');
 assert.equal((await callback()).next,null);
}));
test('OAuth return targets cannot redirect to an external origin',async()=>fixture(async({stored})=>{
 for(const bad of ['https://other.test/checkout','//other.test/checkout','/\\other.test','/\nother']){stored.set('akili-next',bad);assert.equal((await callback()).next,'/my-library');}
}));
test('Google sign in offers account selection and keeps the intended admin checkout',async()=>fixture(async({stored,calls})=>{
 await googleLogin(target);const u=new URL(calls.find(c=>c.navigation).navigation);assert.equal(u.origin,'https://database.test');
 assert.equal(u.searchParams.get('prompt'),'select_account');assert.equal(u.searchParams.get('code_challenge_method'),'s256');assert.equal(stored.get('akili-next'),target);
 assert.equal(u.searchParams.get('redirect_to'),'https://store.test/auth/callback');
 await googleLogin();assert.equal(stored.has('akili-next'),false);
}));
test('switching accounts revokes only the current app session',async()=>fixture(async({stored,calls})=>{
 stored.set('akili-session',JSON.stringify({access_token:'unit-test-token'}));await signout();assert.equal(stored.has('akili-session'),false);
 const call=calls.find(c=>c.url?.includes('/logout'));assert.equal(new URL(call.url).searchParams.get('scope'),'local');
}));
