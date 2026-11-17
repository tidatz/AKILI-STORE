import {one,insert,patch,eq,supa} from './lib.mjs';
import {ehub,phoneNumber,siteOrigin} from './communications.mjs';
import {smsConfig,smsReady} from './sms-config.mjs';

const emailReady=()=>!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&process.env.SITE_URL);

async function sendEmailOnce(key,recipient,subject,text){
 if(!emailReady()||!recipient)return false;
 await supa('/rest/v1/akili_email_deliveries',{method:'POST',body:{key,recipient,status:'queued'},headers:{Prefer:'resolution=ignore-duplicates'}});
 const current=await one('akili_email_deliveries',eq('key',key));
 if(!current||current.recipient!==recipient)return false;
 if(current.status==='accepted')return true;
 if(['sending','unknown'].includes(current.status))return false;
 const reserved=await patch('akili_email_deliveries',eq('key',key)+'&status=in.(queued,failed)',{status:'sending'});
 if(!reserved.length)return false;
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},
   body:JSON.stringify({from:process.env.EMAIL_FROM,to:[recipient],subject,text})});
  if(!response.ok){await patch('akili_email_deliveries',eq('key',key),{status:'failed'});return false;}
  const result=await response.json().catch(()=>({}));
  await patch('akili_email_deliveries',eq('key',key),{status:'accepted',provider_id:result.id||null});
  return true;
 }catch(error){
  await patch('akili_email_deliveries',eq('key',key)+'&status=eq.sending',{status:'unknown'});
  console.error('AKILI activity email delivery uncertain',error?.name||'network_error');
  return false;
 }
}

export async function emailAuthorSale(order){
 if(!order||order.status!=='paid'||!emailReady())return false;
 const [book,ledger]=await Promise.all([
  one('ebook_books',eq('id',order.book_id),'id,title,author_id'),
  one('akili_ledger',eq('order_id',order.id)+'&account=eq.author','amount_tzs')
 ]);
 const authorId=book?.author_id;
 const author=authorId?await one('akili_profiles',eq('user_id',authorId),'email,display_name'):null;
 if(!book||!author?.email)return false;
 const link=siteOrigin()+'/sales-analytics';
 const name=author.display_name||'Mwandishi';
 const text='Habari '+name+',\n\nHongera! Kitabu chako "'+book.title+'" kimenunuliwa kwenye AKILI STORE.\n\nBei ya mauzo: TSh '+Number(order.amount_tzs).toLocaleString('en-US')+'\nMgao wako uliorekodiwa: TSh '+Number(ledger?.amount_tzs||0).toLocaleString('en-US')+'\n\nTazama mauzo na salio lako: '+link+'\n\nHuu ni ujumbe wa taarifa ya mauzo yaliyothibitishwa.\n\nAKILI STORE · Powered by TIDA TZ COMPANY';
 return sendEmailOnce('author-sale:'+order.id,author.email,'Hongera! Kitabu chako kimeuzwa — AKILI STORE',text);
}

export async function emailAuthorBookDecision(book,status,note=''){
 if(!book?.author_id||!emailReady())return false;
 const author=await one('akili_profiles',eq('user_id',book.author_id),'email,display_name');
 if(!author?.email)return false;
 const state={published:'kimeidhinishwa na kuchapishwa',changes_requested:'kinahitaji marekebisho',rejected:'hakijaidhinishwa',archived:'kimeondolewa dukani'}[status]||status;
 const text='Habari '+(author.display_name||'Mwandishi')+',\n\nTaarifa kuhusu kitabu chako "'+book.title+'": '+state+'.\n'+(note?'Maelezo: '+note+'\n':'')+'\nFungua dashboard yako: '+siteOrigin()+'/author-dashboard\n\nAKILI STORE · Powered by TIDA TZ COMPANY';
 return sendEmailOnce('author-book:'+book.id+':'+status+':'+(book.updated_at||''),author.email,'Taarifa ya kitabu chako — AKILI STORE',text);
}

export async function authorVerifiedSms(userId){
 if(process.env.EHUB_AUTHOR_VERIFICATION_SMS_ENABLED!=='true')return false;
 const profile=await one('akili_profiles',eq('user_id',userId),'phone,display_name,role,status');
 if(!profile||profile.role!=='author'||profile.status!=='active'||!profile.phone)return false;
 const recipient=phoneNumber(profile.phone),key='author-verified:'+userId;
 const config=await smsConfig();if(!smsReady(config))return false;
 await supa('/rest/v1/akili_message_deliveries',{method:'POST',body:{key,recipient,status:'queued'},headers:{Prefer:'resolution=ignore-duplicates'}});
 const current=await one('akili_message_deliveries',eq('key',key));
 if(!current||current.recipient!==recipient||current.status==='accepted'||['sending','unknown'].includes(current.status))return current?.status==='accepted';
 const reserved=await patch('akili_message_deliveries',eq('key',key)+'&status=in.(queued,failed)',{status:'sending'});
 if(!reserved.length)return false;
 let accepted=false;
 try{
  const result=await ehub('/sms/send',{method:'POST',body:{to:recipient,
   message:'AKILI STORE: Hongera '+(profile.display_name||'')+'. Umehakikiwa rasmi kuwa mwandishi. Sasa unaweza kupakia na kusimamia vitabu vyako kupitia '+siteOrigin()+'/author-dashboard',
   sender_id:config.senderId},},config);
  if(!/^[0-9a-f-]{36}$/i.test(result?.message_id||'')){const error=new Error('Incomplete SMS response');error.uncertain=true;throw error;}
  accepted=true;
  await supa('/rest/v1/akili_sms_messages',{method:'POST',body:{provider_message_id:result.message_id,phone:recipient,status:'sent'},headers:{Prefer:'resolution=ignore-duplicates'}});
  await patch('akili_message_deliveries',eq('key',key),{status:'accepted',provider_message_id:result.message_id});
  return true;
 }catch(error){
  await patch('akili_message_deliveries',eq('key',key)+'&status=eq.sending',{status:accepted||error.uncertain?'unknown':'failed'});
  console.error('Author verification SMS was not confirmed',error?.name||'provider_error');
  return false;
 }
}
