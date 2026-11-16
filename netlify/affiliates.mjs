import crypto from 'node:crypto';
import {HttpError,clean,sha,randomToken,supa,rows,one,insert,patch,eq} from './lib.mjs';

const pct=value=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100)throw new HttpError(400,'Commission lazima iwe kati ya 0% na 100% ya mgao wa AKILI STORE.');
  return Math.round(n*100)/100;
};
const safeCode=value=>clean(value,80).toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'')))throw new HttpError(400,'Kitambulisho si sahihi.');return value;};

export async function affiliateReady(){
  try{await one('akili_affiliates','select=id&limit=1');return true;}catch{return false;}
}

export async function publicAffiliateVisit(params,headers={}){
  if(!(await affiliateReady()))throw new HttpError(503,'Mfumo wa affiliate unasubiri maandalizi ya database.');
  const code=safeCode(params?.ref);
  if(!code)throw new HttpError(400,'Link ya affiliate si sahihi.');
  const affiliate=await one('akili_affiliates',eq('code',code));
  if(!affiliate||affiliate.status!=='active')throw new HttpError(404,'Link hii ya affiliate haipatikani.');
  let campaign=null,productId=null,rate=0;
  if(params?.campaign){
    campaign=await one('akili_affiliate_campaigns',eq('code',safeCode(params.campaign)));
    const now=Date.now();
    if(!campaign||campaign.status!=='active'||Date.parse(campaign.starts_at)>now||
      campaign.ends_at&&Date.parse(campaign.ends_at)<=now)throw new HttpError(404,'Kampeni hii haipo au imefungwa.');
    if(campaign.product_id&&campaign.product_id!==params.product)throw new HttpError(400,'Kampeni hii imefungwa kwa bidhaa maalumu.');
    rate=Number(campaign.commission_percent_of_platform);
    productId=campaign.product_id||null;
  }
  if(params?.product){
    productId=uuid(params.product);
    const product=await one('ebook_books',eq('id',productId),'id,status');
    if(!product||product.status!=='published')throw new HttpError(404,'Bidhaa haipatikani.');
    if(campaign?.product_id&&campaign.product_id!==productId)throw new HttpError(400,'Bidhaa haifanani na kampeni.');
  }
  if(!campaign&&productId){
    const rule=await one('akili_affiliate_product_rules',eq('product_id',productId)+'&active=eq.true');
    rate=Number(rule?.commission_percent_of_platform||0);
  }
  const token=randomToken();
  const referrer=(()=>{try{return new URL(headers.referer||headers.referrer||'').hostname.slice(0,160);}catch{return '';}})();
  const landing=clean(params?.landing,300);
  await insert('akili_affiliate_clicks',{
    affiliate_id:affiliate.id,campaign_id:campaign?.id||null,product_id:productId,
    token_hash:sha(token),commission_percent_of_platform:rate,
    landing_path:landing.startsWith('/')?landing.slice(0,300):'/',referrer_host:referrer,
    expires_at:new Date(Date.now()+30*86400000).toISOString()
  });
  return {token,expires_in_days:30};
}

export async function attachAffiliateOrder(order,token,productId){
  if(!token)return {attributed:false};
  if(!(await affiliateReady()))throw new HttpError(503,'Mfumo wa affiliate haujaandaliwa.');
  if(typeof token!=='string'||token.length<32||token.length>200)throw new HttpError(400,'Taarifa za referral si sahihi.');
  const click=await one('akili_affiliate_clicks',eq('token_hash',sha(token)));
  if(!click||Date.parse(click.expires_at)<=Date.now()||
    click.product_id&&click.product_id!==productId)throw new HttpError(400,'Link ya affiliate imeisha au haihusiani na bidhaa hii.');
  const affiliate=await one('akili_affiliates',eq('id',click.affiliate_id));
  if(!affiliate||affiliate.status!=='active')throw new HttpError(400,'Affiliate huyu hayupo active.');
  const existing=await one('akili_order_attributions',eq('order_id',order.id));
  if(existing)return {attributed:existing.affiliate_id===affiliate.id};
  try{
    await insert('akili_order_attributions',{
      order_id:order.id,click_id:click.id,affiliate_id:affiliate.id,
      campaign_id:click.campaign_id,product_id:productId,
      commission_percent_of_platform:click.commission_percent_of_platform
    });
  }catch(error){
    const prior=await one('akili_order_attributions',eq('order_id',order.id));
    if(prior?.affiliate_id===affiliate.id)return {attributed:true};
    throw new HttpError(409,'Oda hii tayari ina referral attribution tofauti.');
  }
  return {attributed:true};
}

export async function affiliateAction(u,action,b,method){
  if(!['market-affiliate-apply','market-affiliate-data'].includes(action)&&!action.startsWith('market-admin-affiliate-'))return undefined;
  if(!(await affiliateReady()))throw new HttpError(503,'Affiliate engine bado inasubiri migration ya database.');
  if(action==='market-affiliate-apply'&&method==='POST'){
    const existing=await one('akili_affiliates',eq('user_id',u.id));
    if(existing)return {status:existing.status,code:existing.status==='active'?existing.code:null};
    const base=safeCode(u.profile.display_name)||'creator';
    const code=base+'-'+crypto.randomBytes(3).toString('hex');
    await insert('akili_affiliates',{user_id:u.id,code,status:'pending'});
    await insert('akili_audit_logs',{actor_id:u.id,action:'affiliate.applied',target_id:u.id,details:{}});
    return {status:'pending'};
  }
  if(action==='market-affiliate-data'&&method==='GET'){
    const affiliate=await one('akili_affiliates',eq('user_id',u.id));
    if(!affiliate||affiliate.status!=='active')return {status:affiliate?.status||'not_applied'};
    const [clicks,ledger,campaigns]=await Promise.all([
      rows('akili_affiliate_clicks','select=id,campaign_id,product_id,created_at,expires_at&'+eq('affiliate_id',affiliate.id)+'&order=created_at.desc&limit=100'),
      rows('akili_ledger','select=order_id,amount_tzs,created_at,campaign_id&account=eq.affiliate&'+eq('affiliate_id',affiliate.id)+'&order=created_at.desc&limit=300'),
      rows('akili_affiliate_campaigns','select=name,code,product_id,starts_at,ends_at&status=eq.active&order=created_at.desc&limit=100')
    ]);
    return {status:'active',code:affiliate.code,clicks:clicks.length,ledger,earned:ledger.reduce((s,x)=>s+x.amount_tzs,0),campaigns};
  }
  if(!action.startsWith('market-admin-affiliate-'))return undefined;
  if(!u.isAdmin)throw new HttpError(403,'Huna ruhusa ya admin.');
  if(action==='market-admin-affiliate-data'&&method==='GET'){
    const [affiliates,campaigns,rules,ledger,books]=await Promise.all([
      rows('akili_affiliates','select=*&order=created_at.desc&limit=500'),
      rows('akili_affiliate_campaigns','select=*&order=created_at.desc&limit=300'),
      rows('akili_affiliate_product_rules','select=*&order=updated_at.desc&limit=500'),
      rows('akili_ledger','select=order_id,affiliate_id,campaign_id,amount_tzs,commission_percent_of_platform,created_at&account=eq.affiliate&order=created_at.desc&limit=1000'),
      rows('ebook_books','select=id,title,slug,price_tzs,status&status=eq.published&order=title.asc&limit=500')
    ]);
    const profiles=affiliates.length?await rows('akili_profiles','select=user_id,display_name,email&user_id=in.('+affiliates.map(x=>x.user_id).join(',')+')'):[];
    return {affiliates:affiliates.map(x=>({...x,display_name:profiles.find(p=>p.user_id===x.user_id)?.display_name||'',email:profiles.find(p=>p.user_id===x.user_id)?.email||''})),campaigns,rules,ledger,books};
  }
  if(action==='market-admin-affiliate-status'&&method==='POST'){
    const id=uuid(b.id),status=b.status;
    if(!['active','suspended','rejected'].includes(status))throw new HttpError(400,'Hali ya affiliate si sahihi.');
    const affiliate=await one('akili_affiliates',eq('id',id));if(!affiliate)throw new HttpError(404,'Affiliate hajapatikana.');
    const result=await patch('akili_affiliates',eq('id',id),{status,approved_by:status==='active'?u.id:affiliate.approved_by,approved_at:status==='active'?new Date().toISOString():affiliate.approved_at,updated_at:new Date().toISOString()});
    await insert('akili_audit_logs',{actor_id:u.id,action:'affiliate.'+status,target_id:id,details:{}});
    return {saved:true,affiliate:result[0]};
  }
  if(action==='market-admin-affiliate-campaign'&&method==='POST'){
    const name=clean(b.name,120),description=clean(b.description,1000);
    if(name.length<2)throw new HttpError(400,'Jina la kampeni linahitajika.');
    const rate=pct(b.commission_percent_of_platform);
    const productId=b.product_id?uuid(b.product_id):null;
    if(productId){const product=await one('ebook_books',eq('id',productId),'id,status');if(!product||product.status!=='published')throw new HttpError(400,'Chagua bidhaa iliyochapishwa.');}
    const starts=b.starts_at?new Date(b.starts_at):new Date(),ends=b.ends_at?new Date(b.ends_at):null;
    if(!Number.isFinite(starts.getTime())||ends&&!Number.isFinite(ends.getTime())||ends&&ends<=starts)throw new HttpError(400,'Tarehe za kampeni si sahihi.');
    const base=safeCode(b.code||name)||'kampeni';
    const code=base+'-'+crypto.randomBytes(2).toString('hex');
    const result=await insert('akili_affiliate_campaigns',{name,description,code,product_id:productId,commission_percent_of_platform:rate,status:['draft','active','paused'].includes(b.status)?b.status:'draft',starts_at:starts.toISOString(),ends_at:ends?.toISOString()||null,created_by:u.id});
    await insert('akili_audit_logs',{actor_id:u.id,action:'affiliate.campaign_created',target_id:result[0].id,details:{code,rate,product_id:productId}});
    return {campaign:result[0]};
  }
  if(action==='market-admin-affiliate-campaign-status'&&method==='POST'){
    const id=uuid(b.id),status=b.status;
    if(!['active','paused','ended','draft'].includes(status))throw new HttpError(400,'Hali ya kampeni si sahihi.');
    const result=await patch('akili_affiliate_campaigns',eq('id',id),{status,updated_at:new Date().toISOString()});
    if(!result.length)throw new HttpError(404,'Kampeni haijapatikana.');
    await insert('akili_audit_logs',{actor_id:u.id,action:'affiliate.campaign_'+status,target_id:id,details:{}});
    return {saved:true};
  }
  if(action==='market-admin-affiliate-product-rule'&&method==='POST'){
    const productId=uuid(b.product_id),rate=pct(b.commission_percent_of_platform),active=b.active!==false;
    const product=await one('ebook_books',eq('id',productId),'id,status');if(!product||product.status!=='published')throw new HttpError(400,'Chagua bidhaa iliyochapishwa.');
    const existing=await one('akili_affiliate_product_rules',eq('product_id',productId));
    const values={commission_percent_of_platform:rate,active,updated_at:new Date().toISOString(),created_by:u.id};
    const result=existing?await patch('akili_affiliate_product_rules',eq('product_id',productId),values):await insert('akili_affiliate_product_rules',{product_id:productId,...values});
    await insert('akili_audit_logs',{actor_id:u.id,action:'affiliate.product_rule_updated',target_id:productId,details:{rate,active}});
    return {saved:true,rule:result[0]};
  }
  throw new HttpError(404,'Huduma ya affiliate haijapatikana.');
}
