import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
export const clean = (v, max=200) => String(v ?? '').trim().slice(0,max);
const base = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503,'Database configuration haijakamilika.');
  return {url,key};
};
export async function supa(path, {method='GET',body,headers={}}={}) {
  const {url,key}=base();
  const response=await fetch(url+path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',
      ...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const raw=await response.text();
  let result; try {result=raw?JSON.parse(raw):null;} catch {result=raw;}
  if(!response.ok) { console.error('Supabase API error',response.status,String(result?.message||result).slice(0,180));
    throw new HttpError(502,'Tatizo la kuhifadhi au kusoma taarifa.'); }
  return result;
}
export async function rows(table, query='') {return await supa('/rest/v1/'+table+'?'+query);}
export async function insert(table, values) {return await supa('/rest/v1/'+table,{method:'POST',body:values,headers:{Prefer:'return=representation'}});}
export async function patch(table, query, values) {return await supa('/rest/v1/'+table+'?'+query,{method:'PATCH',body:values,headers:{Prefer:'return=representation'}});}
export async function remove(table, query) {return await supa('/rest/v1/'+table+'?'+query,{method:'DELETE',headers:{Prefer:'return=representation'}});}
export const eq = (key,value) => key+'=eq.'+encodeURIComponent(String(value));
export async function one(table,filter,select='*') {
  const result=await rows(table, 'select='+encodeURIComponent(select)+'&'+filter+'&limit=1');
  return result?.[0]||null;
}
export function assetUrl(path) {
  if(!path) return null;
  const {url}=base();
  return url+'/storage/v1/object/public/ebook-assets/'+path.split('/').map(encodeURIComponent).join('/');
}
export async function signFile(bucket,path,expiresIn=900) {
  const result=await supa('/storage/v1/object/sign/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),
    {method:'POST',body:{expiresIn}});
  if(!result?.signedURL) throw new HttpError(502,'PDF haipatikani kwa sasa.');
  return new URL(result.signedURL,base().url).href;
}
export async function adminUser(event) {
  const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) throw new HttpError(401,'Ingia kama Admin.');
  const {url,key}=base();
  const response=await fetch(url+'/auth/v1/user',{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY||key,Authorization:'Bearer '+token}});
  if(!response.ok) throw new HttpError(401,'Session imeisha. Ingia tena.');
  const user=await response.json();
  if(!isUuid(user.id) || !await one('ebook_admins',eq('user_id',user.id))) throw new HttpError(403,'Huna ruhusa ya Admin.');
  return user;
}
export async function snippe(path,options={}) {
  const key=process.env.SNIPPE_API_KEY;
  if(!key) throw new HttpError(503,'Snippe haijaunganishwa.');
  const response=await fetch('https://api.snippe.sh/v1'+path,{
    method:options.method||'GET',
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})},
    ...(options.body?{body:JSON.stringify(options.body)}:{})
  });
  const json=await response.json().catch(()=>null);
  if(!response.ok||json?.status==='error') {
    console.error('Snippe API failure',response.status,json?.error_code||'unknown');
    throw new HttpError(502,'Malipo hayakuanzishwa au kuthibitishwa. Jaribu tena.');
  }
  return json?.data;
}
export function verifyWebhook(event) {
  const secret=process.env.SNIPPE_WEBHOOK_SECRET;
  if(!secret) throw new HttpError(503,'Webhook signing secret haijawekwa.');
  const h=Object.fromEntries(Object.entries(event.headers).map(([k,v])=>[k.toLowerCase(),v]));
  const timestamp=String(h['x-webhook-timestamp']||'');
  const signature=String(h['x-webhook-signature']||'');
  if(!/^\d+$/.test(timestamp)||!/^[0-9a-f]{64}$/i.test(signature)) throw new HttpError(401,'Invalid webhook headers');
  if(Math.abs(Math.floor(Date.now()/1000)-Number(timestamp))>300) throw new HttpError(401,'Stale webhook');
  const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
  const expected=crypto.createHmac('sha256',secret).update(timestamp+'.'+raw).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'))) throw new HttpError(401,'Invalid signature');
  try{return JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON');}
}
export async function applyPayment(reference,orderId,eventId) {
  const payment=await one('ebook_payments',eq('provider_reference',reference));
  if(!payment || payment.order_id!==orderId) throw new HttpError(409,'Payment mismatch');
  const verified=await snippe('/payments/'+encodeURIComponent(reference));
  const status=verified?.status;
  if(!['pending','completed','failed','expired','voided'].includes(status)) throw new HttpError(502,'Provider status haieleweki.');
  if(Number(verified?.amount?.value)!==payment.amount_tzs||verified?.amount?.currency!=='TZS')
    throw new HttpError(409,'Amount mismatch');
  if(status==='pending') return 'pending';
  await supa('/rest/v1/rpc/ebook_apply_payment_event',{method:'POST',
    body:{p_event_id:eventId,p_reference:reference,p_order_id:orderId,
      p_status:status,p_amount:payment.amount_tzs,p_currency:'TZS'}});
  return status;
}
export async function generateAccess(orderId) {
  const token=randomToken();
  await insert('ebook_access_tokens',{order_id:orderId,token_hash:sha(token),
    expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString()});
  return token;
}
export async function emailAccess(order,force=false) {
  if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM||!process.env.SITE_URL) return false;
  if(order.email_sent_at&&!force) return true;
  const book=await one('ebook_books',eq('id',order.book_id),'title');
  if(!book) throw new HttpError(404,'Kitabu hakipo.');
  const token=await generateAccess(order.id);
  const link=process.env.SITE_URL.replace(/\/$/,'')+'/reader.html?token='+token;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',
    headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.EMAIL_FROM,to:[order.customer_email],
      subject:'Kiungo cha kusoma kitabu chako',text:'Malipo yako yamethibitishwa. Kitabu: '+book.title+'\nFungua hapa: '+link+'\nKiungo hiki kinaisha baada ya siku 30.'})});
  if(!response.ok) {console.error('Email provider failed',response.status);return false;}
  await patch('ebook_orders',eq('id',order.id),{email_sent_at:new Date().toISOString()});
  return true;
}
