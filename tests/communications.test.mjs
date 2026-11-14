import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {bulkValues,ehub,sendBulk,verifySmsWebhook,receiveSms,emailInvitation} from '../netlify/communications.mjs';
import app from '../api/index.js';

const uid='11111111-1111-4111-8111-111111111111',sender='22222222-2222-4222-8222-222222222222';
const campaignId='33333333-3333-4333-8333-333333333333',messageId='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const originalFetch=global.fetch;
const env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'server-test',SUPABASE_PUBLISHABLE_KEY:'public-test',EHUB_API_KEY:'key-test',EHUB_API_SECRET:'secret-test',EHUB_SENDER_ID:sender,EHUB_WEBHOOK_SECRET:'webhook-test',SITE_URL:'https://akili.test'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function fixture(callback,{timeout=false,role='admin',saveFails=false,mailStatus=200}={}){
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const state={campaign:null,sends:0,messages:[],calls:[]};
 global.fetch=async(input,opts={})=>{
  const url=new URL(input),path=url.pathname,body=opts.body?JSON.parse(opts.body):null;state.calls.push({url:url.href,...opts});
  if(url.hostname==='sms.ehub.co.tz'){
   const raw=opts.body||'',ts=opts.headers['X-Timestamp'];
   const expected=crypto.createHmac('sha256',env.EHUB_API_SECRET).update([ts,opts.method,path,raw].join('\n')).digest('hex');
   assert.equal(opts.headers['X-Signature'],expected);assert.equal(opts.headers.Authorization,'Bearer '+env.EHUB_API_KEY);
   if(path.includes('/sender-ids/'))return response({success:true,data:{id:sender,status:'approved',sender_name:'AKILISTORE'}});
   if(path.endsWith('/send-bulk')){state.sends++;if(timeout)throw Error('connection interrupted after send');return response({success:true,data:{campaign_id:campaignId,total_cost:'25.00',messages:[{message_id:messageId,to:'0712345678'}]}});}
   if(path.endsWith('/wallet/balance'))return response({success:true,data:{sms_balance:32,currency:'TZS'}});
  }
  if(path==='/auth/v1/user')return response({id:uid,email:'qa@example.invalid',email_confirmed_at:'2026-01-01'});
  if(path==='/auth/v1/otp')return response(mailStatus===200?{}:{msg:'Email delivery unavailable'},mailStatus);
  if(path==='/rest/v1/akili_author_invitations'&&opts.method==='PATCH')return response([{id:requestId,...body}]);
  if(path==='/rest/v1/ebook_admins')return response(role==='admin'?[{user_id:uid}]:[]);
  if(path==='/rest/v1/akili_profiles')return response([{user_id:uid,email:'qa@example.invalid',role:'reader',status:'active'}]);
  if(path==='/rest/v1/akili_sms_campaigns'){
   if(opts.method==='POST'){if(!state.campaign)state.campaign={...body,status:'draft'};return response(null);}
   if(opts.method==='PATCH'){const expected=url.searchParams.get('status');if(expected&&state.campaign.status!==expected.slice(3))return response([]);if(saveFails&&body.status==='accepted')throw Error('Database write interrupted');Object.assign(state.campaign,body);return response([state.campaign]);}
   return response(state.campaign?[state.campaign]:[]);
  }
  if(path==='/rest/v1/akili_sms_messages'){
   if(opts.method==='POST'){state.messages.push(body);return response(null);}
   if(opts.method==='PATCH'){const m=state.messages.find(x=>x.provider_message_id===messageId);if(m?.status==='delivered')return response([]);Object.assign(m,body);return response([m]);}
   return response(state.messages);
  }
  throw Error('Unexpected request '+path);
 };
 try{await callback(state);}finally{global.fetch=originalFetch;for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('SMS normalizes Tanzania numbers, deduplicates and rejects invalid recipients before sending',()=>{
 assert.deepEqual(bulkValues({message:'Taarifa',recipients:'0712345678, +255712345678; 0687654321'}).recipients,['255687654321','255712345678']);
 for(const recipients of ['', 'not-a-phone','255123456789',Array(1001).fill('0712345678')])assert.throws(()=>bulkValues({message:'Taarifa',recipients}));
 assert.throws(()=>bulkValues({message:'x'.repeat(641),recipients:'0712345678'}));
});
test('eHub signs the exact path, method, timestamp and raw body for every request',async()=>fixture(async()=>{
 assert.equal((await ehub('/wallet/balance')).sms_balance,32);
 await assert.rejects(ehub('https://other.test/collect'));
}));
const bulk={requestId,recipients:['0712345678','255712345678'],message:'Taarifa ya kitabu.',name:'Waandishi',confirmed:true};
test('a repeated bulk request cannot debit or send twice',async()=>fixture(async state=>{
 const first=await sendBulk({id:uid},bulk),again=await sendBulk({id:uid},bulk);
 assert.equal(first.campaign.status,'accepted');assert.equal(again.campaign.status,'accepted');assert.equal(state.sends,1);assert.equal(state.messages.length,1);
 await assert.rejects(sendBulk({id:uid},{...bulk,message:'Changed'}),/kimetumika/);
 assert.equal(state.sends,1);
}));
test('an uncertain SMS submission is recorded and never blindly retried',async()=>fixture(async state=>{
 await assert.rejects(sendBulk({id:uid},bulk));assert.equal(state.campaign.status,'unknown');
 await assert.rejects(sendBulk({id:uid},bulk),/tayari/);assert.equal(state.sends,1);
},{timeout:true}));
test('provider acceptance followed by a database interruption remains uncertain and cannot resend',async()=>fixture(async state=>{
 await assert.rejects(sendBulk({id:uid},bulk));assert.equal(state.campaign.status,'unknown');
 await assert.rejects(sendBulk({id:uid},bulk),/tayari/);assert.equal(state.sends,1);
},{saveFails:true}));
test('a reader cannot submit or inspect an admin SMS campaign',async()=>fixture(async state=>{
 for(const action of ['market-admin-sms-data','market-admin-sms-preview','market-admin-sms-send']){
  const r=await app.fetch(new Request('https://akili.test/api?action='+action,{method:'POST',headers:{Authorization:'Bearer reader','Content-Type':'application/json'},body:JSON.stringify(bulk)}));assert.equal(r.status,403);
 }
 assert.equal(state.sends,0);
},{role:'reader'}));
function delivery(status='delivered'){
 const body=JSON.stringify({event:'sms.'+status,message_id:messageId,to:'+255712345678',status,timestamp:Math.floor(Date.now()/1000)});
 return {body,headers:{'x-ehub-signature':crypto.createHmac('sha256',env.EHUB_WEBHOOK_SECRET).update(body).digest('hex')}};
}
test('delivery webhooks require an authentic raw body and cannot downgrade delivered messages',async()=>fixture(async state=>{
 state.messages.push({provider_message_id:messageId,phone:'255712345678',status:'queued'});
 const event=delivery();assert.equal(verifySmsWebhook(event).status,'delivered');
 assert.throws(()=>verifySmsWebhook({...event,body:event.body+' '}));
 await receiveSms(event);await receiveSms(event);await receiveSms(delivery('failed'));
 assert.equal(state.messages[0].status,'delivered');
 state.messages[0].phone='255713111222';await assert.rejects(receiveSms(event),/recipient mismatch/);
}));
test('an invitation never claims an email was sent without a configured email sender',async()=>{
 const old=process.env.RESEND_API_KEY;delete process.env.RESEND_API_KEY;
 try{assert.equal(await emailInvitation('author@example.invalid','test',requestId),false);}finally{if(old!==undefined)process.env.RESEND_API_KEY=old;}
});
test('author email access reuses the existing Auth sender and a first-party callback',async()=>fixture(async state=>{
 assert.equal(await emailInvitation('author@example.invalid','invitation-token',requestId),true);
 const mail=state.calls.find(c=>new URL(c.url).pathname==='/auth/v1/otp');assert.ok(mail);
 assert.equal(new URL(mail.url).searchParams.get('redirect_to'),'https://akili.test/auth/callback');
 assert.deepEqual(JSON.parse(mail.body),{email:'author@example.invalid',create_user:true});
 assert.equal(state.calls.some(c=>new URL(c.url).pathname==='/rest/v1/akili_author_invitations'&&c.method==='PATCH'),true);
}));
test('Auth email failure or rate limit is not reported as a sent invitation',async()=>fixture(async state=>{
 assert.equal(await emailInvitation('author@example.invalid','invitation-token',requestId),false);
 assert.equal(state.calls.some(c=>new URL(c.url).pathname==='/rest/v1/akili_author_invitations'&&c.method==='PATCH'),false);
},{mailStatus:429}));
