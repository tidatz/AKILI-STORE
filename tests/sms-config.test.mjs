import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../api/index.js';
import {receiveSms,sendBulk} from '../netlify/communications.mjs';

const uid='11111111-1111-4111-8111-111111111111',sender='22222222-2222-4222-8222-222222222222';
const credentials={apiKey:'private-key-for-test',apiSecret:'private-signing-secret-for-test'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const api=(action,body,token='admin')=>app.fetch(new Request('https://akili.test/api?action='+action,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
async function fixture(run,{role='admin',approved=true,pages=1}={}){
 const env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'server-key',SUPABASE_PUBLISHABLE_KEY:'public-key',EHUB_API_KEY:undefined,EHUB_API_SECRET:undefined,EHUB_SENDER_ID:undefined,EHUB_WEBHOOK_SECRET:undefined};
 const prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),oldFetch=global.fetch;
 for(const[k,v]of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 const state={config:{},writes:0,sends:0,paths:[],audits:[]};
 global.fetch=async(input,opts={})=>{
  const url=new URL(input),path=url.pathname,b=opts.body?JSON.parse(opts.body):null;state.paths.push(path+url.search);
  if(url.hostname==='sms.ehub.co.tz'){
   assert.equal(opts.method,'GET','setup must not send or spend credits');
   const ts=opts.headers['X-Timestamp'];assert.equal(opts.headers.Authorization,'Bearer '+credentials.apiKey);
   assert.equal(opts.headers['X-Signature'],crypto.createHmac('sha256',credentials.apiSecret).update([ts,'GET',path,''].join('\n')).digest('hex'));
   if(path==='/api/v1/sender-ids')return json({success:true,data:{own:Number(url.searchParams.get('page')||1)===pages?[{id:sender,sender_name:'AKILI STORE',status:approved?'approved':'pending'}]:[],shared:[],public:[{id:sender,sender_name:'PUBLIC',status:'approved'}],pagination:{last_page:pages}}});
   if(path==='/api/v1/wallet/balance')return json({success:true,data:{sms_balance:49,currency:'TZS'}});
   if(path.startsWith('/api/v1/sms/'))state.sends++;
   throw Error('Unexpected provider request');
  }
  if(path==='/auth/v1/user')return json({id:uid,email:'owner@example.invalid',email_confirmed_at:'2026-01-01'});
  if(path==='/rest/v1/ebook_admins')return json(role==='admin'?[{user_id:uid}]:[]);
  if(path==='/rest/v1/akili_profiles')return json([{user_id:uid,role:'reader',status:'active'}]);
  if(path==='/rest/v1/rpc/akili_ehub_config_read')return json(state.config);
  if(path==='/rest/v1/rpc/akili_ehub_config_save'){state.writes++;assert.equal(b.p_actor,uid);state.config={...state.config,...b.p_values};return json(true);}
  if(path==='/rest/v1/akili_sms_campaigns')return json([]);
  if(path==='/rest/v1/akili_audit_logs'){state.audits.push(b);return json([b]);}
  throw Error('Unexpected request '+path);
 };
 try{await run(state);}finally{global.fetch=oldFetch;for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('admin setup discovers AKILI STORE UUID and validates balance without sending or returning credentials',async()=>fixture(async state=>{
 const response=await api('market-admin-sms-connect',credentials);assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{saved:true,sender:'AKILI STORE',balance:49});assert.equal(state.writes,1);assert.equal(state.config.senderId,sender);
 const status=await (await api('market-admin-sms-data')).json();assert.equal(status.api_configured,true);assert.equal(status.configured,false);
 assert.equal(JSON.stringify(status).includes(credentials.apiKey),false);assert.equal(JSON.stringify(status).includes(credentials.apiSecret),false);
 assert.equal(JSON.stringify(state.audits).includes(credentials.apiKey),false);assert.equal(state.sends,0);
 await assert.rejects(sendBulk({id:uid},{requestId:uid,message:'Test',recipients:'0712345678',confirmed:true}),/webhook/);
 const wh=await api('market-admin-sms-webhook',{webhookSecret:'private-delivery-secret'});assert.equal(wh.status,200);
 const ready=await (await api('market-admin-sms-data')).json();assert.equal(ready.configured,true);assert.equal(JSON.stringify(ready).includes('private-delivery-secret'),false);
 const body=JSON.stringify({event:'webhook.test'}),headers={'x-ehub-signature':crypto.createHmac('sha256','private-delivery-secret').update(body).digest('hex')};
 assert.deepEqual(await receiveSms({body,headers}),{received:true});await assert.rejects(receiveSms({body:body+' ',headers}),/signature/);
}));
test('reader cannot configure, replace or inspect SMS credentials',async()=>fixture(async state=>{
 for(const action of ['market-admin-sms-connect','market-admin-sms-webhook','market-admin-sms-data'])assert.equal((await api(action,credentials)).status,403);
 assert.equal(state.writes,0);assert.equal(state.paths.some(p=>p.includes('akili_ehub_config')),false);
},{role:'reader'}));
test('pending or unrelated sender cannot save credentials',async()=>fixture(async state=>{
 assert.equal((await api('market-admin-sms-connect',credentials)).status,409);assert.equal(state.writes,0);assert.equal(state.sends,0);
},{approved:false}));
test('sender discovery follows documented pages before selecting the approved name',async()=>fixture(async state=>{
 assert.equal((await api('market-admin-sms-connect',credentials)).status,200);assert.ok(state.paths.includes('/api/v1/sender-ids?page=2'));
},{pages:2}));
test('invalid secrets fail before provider access and webhook requires a verified API connection',async()=>fixture(async state=>{
 assert.equal((await api('market-admin-sms-connect',{...credentials,apiKey:'bad key'})).status,400);
 assert.equal((await api('market-admin-sms-webhook',{webhookSecret:'private-delivery-secret'})).status,409);
 assert.equal(state.paths.some(p=>p.startsWith('/api/')),false);assert.equal(state.writes,0);
}));
