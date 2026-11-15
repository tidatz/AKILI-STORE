import {HttpError,clean,sha,randomToken,isUuid,rows,one,insert,patch,supa,eq} from './lib.mjs';

export const designs=['classic','monochrome','glass','illustrative','soft','skeuomorphic'];
export const modes=['normal','light','dark'];
let schemaCache;
export async function experienceReady(){
 if(schemaCache&&schemaCache.until>Date.now())return schemaCache.ready;
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new HttpError(503,'Huduma ya taarifa haijakamilika.');
 const r=await fetch(url+'/rest/v1/akili_author_links?select=id&limit=0',{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
 let ready=r.ok;
 if(!r.ok){const error=await r.json().catch(()=>({}));if(!['PGRST205','42P01'].includes(error.code))throw new HttpError(503,'Imeshindikana kuhakiki mipangilio. Jaribu tena.');ready=false;}
 schemaCache={ready,until:Date.now()+45000};return ready;
}
export function appearance(value,{inherit=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Chagua mwonekano na mode.');
 if(inherit&&value.inherit===true)return {};
 if(!designs.includes(value.design)||!modes.includes(value.mode))throw new HttpError(400,'Mwonekano au mode haijaruhusiwa.');
 return {design:value.design,mode:value.mode};
}
export async function publicAuthorLink(token){
 if(!await experienceReady())throw new HttpError(503,'Link mpya za waandishi bado hazijaamilishwa. Tumia mwaliko wa email wa admin.');
 if(!/^[a-f0-9]{64}$/.test(token||''))throw new HttpError(404,'Kiungo hiki si sahihi.');
 const link=await one('akili_author_links',eq('token_hash',sha(token)),'id,label,expires_at,use_limit,uses,revoked_at');
 if(!link||link.revoked_at||Date.parse(link.expires_at)<=Date.now()||link.uses>=link.use_limit)throw new HttpError(410,'Kiungo hiki kimeisha, kimefungwa au kimefikia kikomo chake. Omba kiungo kipya kwa admin.');
 return {label:link.label,expires_at:link.expires_at};
}
export async function experienceAction(u,action,b,method){
 if(action==='market-preferences'&&method==='POST'){
   const value=appearance(b,{inherit:true});
   return {saved:true,appearance:value,local_only:true,temporary:true,expires_in:1800};
 }
 if(action==='market-accept-author-link'&&method==='POST'){
   if(!await experienceReady())throw new HttpError(503,'Link mpya za waandishi zinasubiri uamilishaji wa database. Tumia mwaliko wa email wa admin kwa sasa.');
   if(!/^[a-f0-9]{64}$/.test(b.token||''))throw new HttpError(400,'Kiungo si sahihi.');
   // Verification, quota, revocation and promotion happen together under a row lock.
   await supa('/rest/v1/rpc/akili_accept_author_link',{method:'POST',body:{p_user:u.id,p_hash:sha(b.token)}});return {accepted:true};
 }
 if(!action.startsWith('market-admin-'))return undefined;
 if(!u.isAdmin)throw new HttpError(403,'Huna ruhusa ya admin.');
 if(['market-admin-author-link','market-admin-revoke-author-link','market-admin-access-list','market-admin-access','market-admin-role','market-admin-account'].includes(action)&&!await experienceReady())throw new HttpError(503,'Kipengele hiki kinasubiri idhini ya kusasisha database.');
 if(action==='market-admin-author-link'&&method==='POST'){
   const days=Number(b.days),use_limit=Number(b.use_limit),label=clean(b.label,100);
   if(label.length<2||!Number.isInteger(days)||days<1||days>90||!Number.isInteger(use_limit)||use_limit<1||use_limit>1000)throw new HttpError(400,'Jaza jina, siku 1–90 na idadi ya matumizi 1–1,000.');
   const recent=await rows('akili_author_links','select=id&'+eq('created_by',u.id)+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&limit=20');
   if(recent.length>=20)throw new HttpError(429,'Viungo vingi vimeundwa. Subiri kabla ya kuunda kingine.');
   const token=randomToken(),result=await insert('akili_author_links',{label,token_hash:sha(token),created_by:u.id,use_limit,expires_at:new Date(Date.now()+days*86400000).toISOString()});
   await insert('akili_audit_logs',{actor_id:u.id,action:'author.link_created',target_id:result[0].id});
   return {token,id:result[0].id};
 }
 if(action==='market-admin-revoke-author-link'&&method==='POST'){
   if(!isUuid(b.id))throw new HttpError(400,'Kiungo si sahihi.');
   await patch('akili_author_links',eq('id',b.id)+'&revoked_at=is.null',{revoked_at:new Date().toISOString()});
   await insert('akili_audit_logs',{actor_id:u.id,action:'author.link_revoked',target_id:b.id});return {saved:true};
 }
 if(action==='market-admin-user-access'&&method==='GET')return undefined;
 if(action==='market-admin-access-list'&&method==='POST'){
   if(!isUuid(b.userId))throw new HttpError(400,'Mtumiaji si sahihi.');
   const [purchases,grants,orders]=await Promise.all([
     rows('akili_entitlements','select=book_id,revoked_at&'+eq('user_id',b.userId)),
     rows('akili_book_grants','select=book_id,revoked_at&'+eq('user_id',b.userId)),
     rows('ebook_orders','select=book_id&status=eq.paid&'+eq('user_id',b.userId))]);
   const paid=new Set(orders.map(x=>x.book_id));
   return {purchases:purchases.filter(x=>paid.has(x.book_id)),grants};
 }
 if(action==='market-admin-access'&&method==='POST'){
   if(!isUuid(b.userId)||!isUuid(b.bookId)||typeof b.grant!=='boolean')throw new HttpError(400,'Chagua mtumiaji, kitabu na ruhusa.');
   await supa('/rest/v1/rpc/akili_manage_book_access',{method:'POST',body:{p_actor:u.id,p_user:b.userId,p_book:b.bookId,p_grant:b.grant}});return {saved:true};
 }
 if(['market-admin-role','market-admin-account'].includes(action)&&method==='POST'){
   if(!isUuid(b.userId))throw new HttpError(400,'Mtumiaji si sahihi.');
   const operation=action==='market-admin-role'?'role':'account',value=clean(operation==='role'?b.role:b.operation,20);
   if(!(operation==='role'?['reader','author','admin']:['active','restricted','delete','restore']).includes(value))throw new HttpError(400,'Hatua si sahihi.');
   if(operation==='account'&&['restricted','delete'].includes(value)&&b.userId===u.id)throw new HttpError(409,'Huwezi kusitisha au kufuta akaunti yako mwenyewe.');
   const target=await one('akili_profiles',eq('user_id',b.userId));if(!target)throw new HttpError(404,'Akaunti haipo.');
   if(operation==='role'&&target.deleted_at)throw new HttpError(409,'Rejesha akaunti kabla ya kubadilisha jukumu.');
   if(operation==='role'&&value==='admin'&&target.status!=='active')throw new HttpError(409,'Washa akaunti kabla ya kumpa admin.');
   if(operation==='role'&&value!=='admin'||operation==='account'&&['restricted','delete'].includes(value)){
     const admins=await rows('ebook_admins','select=user_id');
     const profiles=await rows('akili_profiles','select=user_id&status=eq.active&deleted_at=is.null&user_id=in.('+admins.map(x=>x.user_id).join(',')+')');
     if(profiles.some(x=>x.user_id===b.userId)&&profiles.length<=1)throw new HttpError(409,'Admin wa mwisho hawezi kuondolewa. Weka admin mwingine kwanza.');
   }
   await supa('/rest/v1/rpc/akili_manage_user',{method:'POST',body:{p_actor:u.id,p_user:b.userId,p_operation:operation,p_value:value}});return {saved:true};
 }
 return undefined;
}
