import crypto from 'node:crypto';
import {HttpError,clean,isUuid,sha,supa,one,rows,insert,patch,eq} from './lib.mjs';

export function siteOrigin(){
 let u;try{u=new URL(process.env.SITE_URL);}catch{throw new HttpError(503,'Anwani rasmi ya duka haijawekwa.');}
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new HttpError(503,'Anwani rasmi ya duka si sahihi.');
 return u.origin;
}
export function phoneNumber(value){
 let n=String(value||'').trim().replace(/[\s()+-]/g,'');if(n.startsWith('0'))n='255'+n.slice(1);
 if(!/^255[67]\d{8}$/.test(n))throw new HttpError(400,'Tumia namba sahihi ya simu ya Tanzania.');return n;
}
export function bulkValues(input){
 const message=String(input.message||'').trim(),name=clean(input.name,120);
 if(!message||message.length>640)throw new HttpError(400,'Ujumbe uwe kati ya herufi 1 na 640.');
 const raw=Array.isArray(input.recipients)?input.recipients:String(input.recipients||'').split(/[\s,;]+/).filter(Boolean);
 if(!raw.length||raw.length>1000)throw new HttpError(400,'Weka namba 1 hadi 1,000.');
 const recipients=[...new Set(raw.map(phoneNumber))].sort();
 return {message,name,recipients,fingerprint:sha(JSON.stringify({message,name,recipients}))};
}
export const smsConfigured=()=>!!(process.env.EHUB_API_KEY&&process.env.EHUB_API_SECRET&&process.env.EHUB_WEBHOOK_SECRET&&isUuid(process.env.EHUB_SENDER_ID));
export const emailConfigured=()=>!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&process.env.SITE_URL);
export async function ehub(path,{method='GET',body}={}){
 if(!process.env.EHUB_API_KEY||!process.env.EHUB_API_SECRET)throw new HttpError(503,'Unganisha akaunti ya eHub kwenye usanidi wa server.');
 if(!/^\/(sms\/(send-bulk|send|history|[a-f0-9-]+)|sender-ids(?:\/[a-f0-9-]+)?|wallet\/balance)$/.test(path))throw new HttpError(400,'Huduma ya SMS si sahihi.');
 const raw=body===undefined?'':JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000)),fullPath='/api/v1'+path;
 const signature=crypto.createHmac('sha256',process.env.EHUB_API_SECRET).update([timestamp,method,fullPath,raw].join('\n')).digest('hex');
 let response;try{response=await fetch('https://sms.ehub.co.tz'+fullPath,{method,signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+process.env.EHUB_API_KEY,'X-Timestamp':timestamp,'X-Signature':signature,'Content-Type':'application/json'},...(body!==undefined?{body:raw}:{})});}
 catch{const e=new HttpError(502,'eHub haijathibitisha ombi. Hakiki historia kabla ya kutuma tena.');e.uncertain=method==='POST';throw e;}
 const json=await response.json().catch(()=>null);
 if(!response.ok||json?.success!==true){const e=new HttpError(response.status===429?429:502,'eHub haijakubali ombi la SMS. Hakiki salio na sender ID.');e.uncertain=method==='POST'&&(response.status>=500||!json);throw e;}
 if(!json.data){const e=new HttpError(502,'Majibu ya eHub hayajakamilika. Hakiki historia ya ujumbe.');e.uncertain=method==='POST';throw e;}
 return json.data;
}
async function approvedSender(){
 if(!smsConfigured())throw new HttpError(503,'Weka API key, API secret, webhook secret na sender ID ya eHub kwenye server.');
 const sender=await ehub('/sender-ids/'+process.env.EHUB_SENDER_ID);
 if(sender.id!==process.env.EHUB_SENDER_ID||String(sender.status).toLowerCase()!=='approved')throw new HttpError(409,'Sender ID ya SMS bado haijaidhinishwa.');return sender;
}
export async function smsAccount(){
 const [sender,balance]=await Promise.all([approvedSender(),ehub('/wallet/balance')]);
 const count=Number(balance.sms_balance);
 if(!Number.isSafeInteger(count)||count<0||balance.currency!=='TZS')throw new HttpError(502,'eHub haijarudisha salio sahihi.');
 return {sender:sender.sender_name,balance:count,currency:balance.currency};
}
export async function sendBulk(u,input){
 if(!isUuid(input.requestId))throw new HttpError(400,'Kitambulisho cha ujumbe si sahihi.');
 const values=bulkValues(input);
 if(input.confirmed!==true)throw new HttpError(400,'Hakiki ujumbe na namba kabla ya kutuma.');
 await approvedSender();
 await supa('/rest/v1/akili_sms_campaigns',{method:'POST',body:{id:input.requestId,actor_id:u.id,...values},headers:{Prefer:'resolution=ignore-duplicates'}});
 let campaign=await one('akili_sms_campaigns',eq('id',input.requestId));
 if(!campaign||campaign.actor_id!==u.id||campaign.fingerprint!==values.fingerprint)throw new HttpError(409,'Kitambulisho hiki kimetumika kwa ujumbe mwingine.');
 if(campaign.status==='accepted')return {campaign};
 if(campaign.status!=='draft')throw new HttpError(409,'Ombi hili tayari limetumwa. Hakiki historia yake kabla ya kuanzisha jipya.');
 const reserved=await patch('akili_sms_campaigns',eq('id',campaign.id)+'&status=eq.draft',{status:'submitting'});
 if(!reserved.length)throw new HttpError(409,'Ujumbe huu unashughulikiwa.');
 try{
  const result=await ehub('/sms/send-bulk',{method:'POST',body:{recipients:values.recipients,message:values.message,sender_id:process.env.EHUB_SENDER_ID,campaign_name:values.name||'AKILI STORE'}});
  if(!isUuid(result.campaign_id)) {const e=new HttpError(502,'Hakiki historia ya eHub kuthibitisha ujumbe.');e.uncertain=true;throw e;}
  // Once eHub accepts, never re-send if saving the provider result is interrupted.
  campaign=(await patch('akili_sms_campaigns',eq('id',campaign.id),{status:'accepted',provider_campaign_id:result.campaign_id,total_cost:result.total_cost??null,submitted_at:new Date().toISOString()}))[0];
  for(const m of result.messages||[])if(isUuid(m.message_id))await supa('/rest/v1/akili_sms_messages',{method:'POST',body:{provider_message_id:m.message_id,campaign_id:campaign.id,phone:phoneNumber(m.to),status:'queued'},headers:{Prefer:'resolution=ignore-duplicates'}});
  return {campaign};
 }catch(e){
  // No automatic POST retry: eHub does not document an idempotency key.
  await patch('akili_sms_campaigns',eq('id',input.requestId)+'&status=eq.submitting',{status:e.uncertain?'unknown':'failed'});throw e;
 }
}
export function verifySmsWebhook(event){
 const secret=process.env.EHUB_WEBHOOK_SECRET;if(!secret)throw new HttpError(503,'Webhook ya eHub haijaunganishwa.');
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 const signature=String(headers['x-ehub-signature']||'');
 const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
 if(raw.length>30000||!/^[a-f0-9]{64}$/i.test(signature))throw new HttpError(401,'Invalid SMS webhook');
 const expected=crypto.createHmac('sha256',secret).update(raw).digest();
 if(!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new HttpError(401,'Invalid SMS signature');
 let data;try{data=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON');}
 if(data.event==='webhook.test')return data;
 if(!isUuid(data.message_id)||!['sms.delivered','sms.failed'].includes(data.event)||data.status!==(data.event==='sms.delivered'?'delivered':'failed'))throw new HttpError(400,'Invalid SMS event');
 phoneNumber(data.to);return data;
}
export async function receiveSms(event){
 const d=verifySmsWebhook(event);if(d.event==='webhook.test')return {received:true};
 const m=await one('akili_sms_messages',eq('provider_message_id',d.message_id));
 if(!m)throw new HttpError(503,'SMS reference not yet stored.');
 if(m.phone!==phoneNumber(d.to))throw new HttpError(409,'SMS recipient mismatch');
 await patch('akili_sms_messages',eq('provider_message_id',d.message_id)+'&status=neq.delivered',{status:d.status,error:d.status==='failed'?clean(d.error,300):'',updated_at:new Date().toISOString()});return {received:true};
}
export async function emailInvitation(email,token,id){
 if(!emailConfigured())return false;
 const url=siteOrigin()+'/invite?token='+token;
 const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'author-invitation/'+id},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:'Mwaliko wa mwandishi — AKILI STORE',text:'Umealikwa kuchapisha vitabu kwenye AKILI STORE.\n\nFungua kiungo hiki, jisajili au ingia kwa email hii, kisha ukubali mwaliko:\n'+url+'\n\nMwaliko unaisha baada ya siku 7. Ruhusa hii ni ya mwandishi pekee.\n\nAKILI STORE'})});
 if(!response.ok)return false;
 await patch('akili_author_invitations',eq('id',id),{email_sent_at:new Date().toISOString()});return true;
}
export async function paidSms(order){
 if(order.status!=='paid'||!smsConfigured()||process.env.EHUB_TRANSACTIONAL_SMS_ENABLED!=='true')return;
 const key='order-paid:'+order.id,recipient=phoneNumber(order.customer_phone);
 await supa('/rest/v1/akili_message_deliveries',{method:'POST',body:{key,recipient,status:'queued'},headers:{Prefer:'resolution=ignore-duplicates'}});
 const lock=await patch('akili_message_deliveries',eq('key',key)+'&status=eq.queued',{status:'sending'});if(!lock.length)return;
 try{
  const result=await ehub('/sms/send',{method:'POST',body:{to:recipient,message:'AKILI STORE: Malipo yako ya TSh '+order.amount_tzs.toLocaleString('en-US')+' yamethibitishwa. Soma kitabu chako: '+siteOrigin()+'/my-library',sender_id:process.env.EHUB_SENDER_ID}});
  if(!isUuid(result.message_id)){const e=new Error('Incomplete SMS response');e.uncertain=true;throw e;}
  await supa('/rest/v1/akili_sms_messages',{method:'POST',body:{provider_message_id:result.message_id,phone:recipient,status:'sent'},headers:{Prefer:'resolution=ignore-duplicates'}});
  await patch('akili_message_deliveries',eq('key',key),{status:'accepted',provider_message_id:result.message_id});
 }catch(e){await patch('akili_message_deliveries',eq('key',key)+'&status=eq.sending',{status:e.uncertain?'unknown':'failed'});}
}
