import crypto from 'node:crypto';
import {uploadKinds,storedBytes,pdfFiles,verifyCover} from './publication.mjs';
import {appearance,publicAuthorLink,experienceAction,experienceReady} from './experience.mjs';
import {HttpError,clean,isUuid,sha,randomToken,supa,rows,one,insert,patch,eq,assetUrl,signFile,adminUser} from './lib.mjs';
import {createProtectedReaderFile} from './reader-protection.mjs';
import {smsConfigured,emailConfigured,invitationEmailConfigured,bulkValues,sendBulk,smsAccount,connectSmsApi,connectSmsWebhook,emailInvitation,siteOrigin} from './communications.mjs';
import {authorVerifiedSms,emailAuthorBookDecision} from './author-notifications.mjs';
import {smsConfig,smsStatus} from './sms-config.mjs';
import {affiliateAction,affiliateReady,publicAffiliateVisit} from './affiliates.mjs';

const uuid=value=>{if(!isUuid(value))throw new HttpError(400,'Kitambulisho si sahihi.');return value;};
const body=event=>{if((event.body||'').length>40000)throw new HttpError(413,'Taarifa ni nyingi.');try{return JSON.parse(event.body||'{}');}catch{throw new HttpError(400,'Taarifa si sahihi.');}};
export const publicBook=b=>({id:b.id,slug:b.slug,title:b.title,subtitle:b.subtitle,description:b.description,price_tzs:b.price_tzs,cover_url:assetUrl(b.cover_path),author_name:b.author_name,category:b.category,language:b.language,page_count:b.page_count,has_preview:!!b.preview_path});
const safeUser=u=>({id:u.id,email:u.email,display_name:u.profile.display_name,phone:u.profile.phone,bio:u.profile.bio,role:u.isAdmin?'admin':u.profile.role,status:u.profile.status,appearance:{}});
export async function currentUser(event,{optional=false}={}){
 const token=String(event.headers?.authorization||event.headers?.Authorization||'').replace(/^Bearer\s+/i,'');
 if(!token){if(optional)return null;throw new HttpError(401,'Ingia kwenye akaunti yako kuendelea.');}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new HttpError(503,'Huduma ya akaunti haipatikani kwa sasa.');
 const response=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new HttpError(401,'Session imeisha. Ingia tena.');
 const u=await response.json();
 if(!isUuid(u.id)||!u.email_confirmed_at)throw new HttpError(403,'Thibitisha email yako kwanza.');
 const [profile,admin]=await Promise.all([one('akili_profiles',eq('user_id',u.id)),one('ebook_admins',eq('user_id',u.id))]);
 u.profile=profile;
 if(!profile){
   await supa('/rest/v1/akili_profiles',{method:'POST',body:{user_id:u.id,display_name:clean(u.user_metadata?.full_name||u.user_metadata?.name||u.email.split('@')[0],100)},headers:{Prefer:'resolution=ignore-duplicates'}});
   u.profile=await one('akili_profiles',eq('user_id',u.id));
 }
 u.isAdmin=!!admin;
 if(u.profile.status!=='active'||u.profile.deleted_at)throw new HttpError(403,'Akaunti hii imesitishwa. Wasiliana na msaada.');
 if(u.profile.email!==u.email.toLowerCase())await patch('akili_profiles',eq('user_id',u.id),{email:u.email.toLowerCase()});
 return u;
}
const audit=(u,action,target,details={})=>insert('akili_audit_logs',{actor_id:u.id,action,target_id:target||null,details});
const notify=(user_id,title,body='',href='/my-library')=>user_id?insert('akili_notifications',{user_id,title,body,href}):Promise.resolve();
const authorizeAuthor=u=>{if(!u.isAdmin&&u.profile.role!=='author')throw new HttpError(403,'Eneo hili ni la waandishi walioalikwa.');};
async function ownBook(u,id){
 authorizeAuthor(u);const book=await one('ebook_books',eq('id',uuid(id)));
 if(!book)throw new HttpError(404,'Kitabu hakijapatikana.');
 if(!u.isAdmin&&book.author_id!==u.id)throw new HttpError(403,'Huna ruhusa kwa kitabu hiki.');
 return book;
}
export async function entitled(u,id){
 uuid(id);const grant=await experienceReady()?await one('akili_book_grants',eq('user_id',u.id)+'&'+eq('book_id',id)+'&revoked_at=is.null'):null;
 if(grant)return {...grant,source:'admin'};
 const access=await one('akili_entitlements',eq('user_id',u.id)+'&'+eq('book_id',uuid(id))+'&revoked_at=is.null');
 if(!access)throw new HttpError(403,'Nunua kitabu hiki kwanza.');
 const order=await one('ebook_orders',eq('id',access.order_id));
 if(order?.status!=='paid'||order.user_id!==u.id)throw new HttpError(403,'Malipo hayajathibitishwa.');
 return access;
}
export async function validatePublication(b){
 if(!b.title?.trim()||!b.author_id||!b.author_name?.trim()||!b.category?.trim()||!Number.isSafeInteger(b.price_tzs)||b.price_tzs<500||!b.cover_path||!b.pdf_path)
   throw new HttpError(400,'Kamilisha jina, mwandishi, kundi, bei, jalada na PDF kamili kabla ya kuchapisha.');
 const author=await one('akili_profiles',eq('user_id',b.author_id));
 if(!author||author.status!=='active'||author.deleted_at||(author.role!=='author'&&!await one('ebook_admins',eq('user_id',b.author_id))))
   throw new HttpError(400,'Mwandishi lazima awe na akaunti iliyoidhinishwa na inayofanya kazi.');
 const [cover,files]=await Promise.all([storedBytes('ebook-assets',b.cover_path,uploadKinds.cover.max,'Jalada'),pdfFiles(b)]);
 await verifyCover(cover);
 return files;
}
const textFields=['slug','title','subtitle','description','author_name','category','language','cover_path','pdf_path','preview_path'];
function bookValues(b){
 const v={};for(const k of textFields)if(Object.hasOwn(b,k))v[k]=clean(b[k],k==='description'?10000:300);
 if(Object.hasOwn(v,'slug')){v.slug=v.slug.toLowerCase();if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug)||v.slug.length>100)throw new HttpError(400,'Tumia kiungo kifupi chenye herufi ndogo na vistari.');}
 if(Object.hasOwn(b,'price_tzs')){v.price_tzs=Number(b.price_tzs);if(!Number.isSafeInteger(v.price_tzs)||v.price_tzs<500)throw new HttpError(400,'Bei iwe angalau TSh 500.');}
 if(Object.hasOwn(b,'page_count')){v.page_count=b.page_count?Number(b.page_count):null;if(v.page_count!==null&&(!Number.isInteger(v.page_count)||v.page_count<1||v.page_count>20000))throw new HttpError(400,'Idadi ya kurasa si sahihi.');}
 for(const k of ['cover_path','pdf_path','preview_path'])if(v[k]&&!/^[-\w/]+\.(png|jpg|jpeg|webp|pdf)$/.test(v[k]))throw new HttpError(400,'Faili si sahihi.');
 return v;
}
export async function marketplace(event,action){
 const method=event.httpMethod;
 if(action==='affiliate-visit'&&method==='GET')return publicAffiliateVisit(event.queryStringParameters||{},event.headers||{});
 if(action==='catalog'&&method==='GET'){
   const [books,settings]=await Promise.all([rows('ebook_books','select=*&status=eq.published&order=featured.desc,created_at.desc&limit=250'),one('ebook_site_settings','id=eq.1')]);
   return {experience_ready:await experienceReady(),books:books.map(publicBook),settings:{site_name:'AKILI STORE',hero_title:settings?.hero_title,hero_description:settings?.hero_description,primary_color:settings?.primary_color,contact:settings?.contact,support_email:settings?.support_email,about_author:settings?.about_author,about_book:settings?.about_book,contents:settings?.contents,author_avatar:assetUrl(settings?.logo_path),appearance:settings?.appearance||{design:'classic',mode:'normal'}},payments_enabled:process.env.SNIPPE_PAYMENTS_ENABLED==='true'};
 }
 if(action==='appearance'&&method==='GET'){
   const settings=await one('ebook_site_settings','id=eq.1','appearance,primary_color');
   return {appearance:settings?.appearance||{design:'classic',mode:'normal'},primary_color:settings?.primary_color||'#1D4ED8'};
 }
 if(action==='preview'&&method==='POST'){
   const b=body(event),book=await one('ebook_books',eq('id',uuid(b.bookId)));
   if(!book||book.status!=='published'||!book.preview_path)throw new HttpError(404,'Sampuli ya kitabu hiki haijawekwa bado.');
   return {url:await signFile('ebook-previews',book.preview_path,300),title:book.title};
 }
 if(action==='book-reviews'&&['GET','POST'].includes(method)){
   const id=uuid(method==='POST'?body(event).bookId:event.queryStringParameters?.bookId);
   const book=await one('ebook_books',eq('id',id),'status');if(book?.status!=='published')throw new HttpError(404,'Kitabu hakipo.');
   const reviews=await rows('akili_reviews','select=rating,body,created_at&'+eq('book_id',id)+'&status=eq.published&order=created_at.desc&limit=30');
   return {reviews};
 }
 if(action==='author-link'&&method==='POST')return publicAuthorLink(body(event).token);
 if(action==='public-author'&&method==='GET'){
   const slug=String(event.queryStringParameters?.slug||'').toLowerCase();
   if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>100)throw new HttpError(404,'Mwandishi hakupatikana.');
   const authors=await rows('akili_profiles','select=user_id,display_name,bio,role,status,deleted_at&role=eq.author&status=eq.active&limit=1000');
   const author=authors.find(p=>!p.deleted_at&&String(p.display_name||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')===slug);
   if(!author)throw new HttpError(404,'Mwandishi hakupatikana.');
   const books=await rows('ebook_books','select=*&'+eq('author_id',author.user_id)+'&status=eq.published&order=featured.desc,created_at.desc&limit=250');
   return {author:{display_name:author.display_name,bio:author.bio||''},books:books.map(publicBook)};
 }
 if(!action.startsWith('market-'))return undefined;
 const u=await currentUser(event),b=method==='POST'?body(event):{};
 const affiliateResult=await affiliateAction(u,action,b,method);if(affiliateResult!==undefined)return affiliateResult;
 const experience=await experienceAction(u,action,b,method);if(experience!==undefined)return experience;
 if(action==='market-me'&&method==='GET'){
   const [unread]=await Promise.all([rows('akili_notifications','select=id&'+eq('user_id',u.id)+'&read_at=is.null&limit=99')]);
   const pending=!u.isAdmin&&u.profile.role==='reader'?await one('akili_author_invitations',eq('email',u.email.toLowerCase())+'&accepted_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.desc','id'):null;
   return {user:{...safeUser(u),author_invitation:pending?.id||null,unread_notifications:unread.length}};
 }
 if(action==='market-profile'&&method==='POST'){
   const display_name=clean(b.display_name,100);if(display_name.length<2)throw new HttpError(400,'Jaza jina lako.');
   await patch('akili_profiles',eq('user_id',u.id),{display_name,phone:clean(b.phone,25),bio:clean(b.bio,1500)});
   return {saved:true};
 }
 if(action==='market-library'&&method==='GET'){
   // Bind historical paid guest orders only after the email has been verified by Auth.
   await patch('ebook_orders',eq('customer_email',u.email.toLowerCase())+'&user_id=is.null&status=eq.paid',{user_id:u.id});
   const orders=await rows('ebook_orders','select=id,book_id,status,created_at,paid_at,amount_tzs&'+eq('user_id',u.id)+'&status=eq.paid&order=paid_at.desc');
   // The webhook has usually created this entitlement already. Match the
   // business unique key rather than the generated primary-key UUID.
   for(const o of orders)await supa('/rest/v1/akili_entitlements?on_conflict=user_id,book_id',{method:'POST',body:{user_id:u.id,book_id:o.book_id,order_id:o.id},headers:{Prefer:'resolution=ignore-duplicates'}});
   const [access,grants,progress]=await Promise.all([rows('akili_entitlements','select=book_id,created_at&'+eq('user_id',u.id)+'&revoked_at=is.null'),experienceReady().then(ready=>ready?rows('akili_book_grants','select=book_id,created_at&'+eq('user_id',u.id)+'&revoked_at=is.null'):[]),rows('akili_reading_progress','select=book_id,page,total_pages&'+eq('user_id',u.id))]);
   const paid=new Set(orders.map(o=>o.book_id)),books=[],seen=new Set();
   for(const a of [...grants.map(x=>({...x,source:'admin'})),...access]){if(seen.has(a.book_id)||a.source!=='admin'&&!paid.has(a.book_id))continue;const book=await one('ebook_books',eq('id',a.book_id));if(book){seen.add(a.book_id);books.push({...publicBook(book),access_source:a.source||'purchase',purchased_at:a.created_at,progress:progress.find(p=>p.book_id===book.id)||null});}}
   return {books};
 }
 if(action==='market-orders'&&method==='GET')return {orders:await rows('ebook_orders','select=id,book_id,amount_tzs,currency,status,created_at,paid_at,verification_test&'+eq('user_id',u.id)+'&order=created_at.desc&limit=200')};
 if(action==='market-purchase'&&method==='POST'){
   const order=await one('ebook_orders',eq('id',uuid(b.orderId))+'&'+eq('user_id',u.id),'id,book_id,amount_tzs,currency,status,paid_at,user_id');
   if(!order||order.user_id!==u.id)throw new HttpError(404,'Oda haijapatikana kwenye akaunti hii.');
   const book=await one('ebook_books',eq('id',order.book_id));
   if(!book)throw new HttpError(404,'Kitabu hakijapatikana. Wasiliana na msaada.');
   if(order.status==='paid')await entitled(u,order.book_id);
   return {order:{id:order.id,book_id:order.book_id,amount_tzs:order.amount_tzs,status:order.status,paid_at:order.paid_at},book:publicBook(book)};
 }
 if(action==='market-access'&&method==='POST'){
   const a=await entitled(u,b.bookId),book=await one('ebook_books',eq('id',a.book_id));
   if(!book?.pdf_path)throw new HttpError(404,'PDF haipatikani. Tafadhali wasiliana na msaada.');
   if(b.purpose==='download')throw new HttpError(403,'Upakuaji wa PDF asili umezimwa. Soma nakala yenye alama ya ulinzi ndani ya AKILI STORE.');
   if(b.purpose&&b.purpose!=='read')throw new HttpError(400,'Aina ya usomaji si sahihi.');
   const [progress,order]=await Promise.all([
     one('akili_reading_progress',eq('user_id',u.id)+'&'+eq('book_id',book.id)),
     a.order_id?one('ebook_orders',eq('id',a.order_id)):Promise.resolve(null)
   ]);
   const protectedFile=await createProtectedReaderFile({book,order,user:u});
   if(a.order_id)await insert('ebook_access_events',{order_id:a.order_id,event_type:'reader_open'});
   else await audit(u,'access.read',book.id,{watermark_ref:protectedFile.reference});
   return {title:book.title,url:protectedFile.url,slug:book.slug,page:progress?.page||1,protected:true,watermark_ref:protectedFile.reference,appearance:{}};
 }
 if(action==='market-progress'&&method==='POST'){
   await entitled(u,b.bookId);
   const page=Number(b.page),total_pages=Number(b.total_pages);
   if(!Number.isInteger(page)||!Number.isInteger(total_pages)||page<1||page>total_pages||total_pages>20000)throw new HttpError(400,'Ukurasa si sahihi.');
   await supa('/rest/v1/akili_reading_progress?on_conflict=user_id,book_id',{method:'POST',body:{user_id:u.id,book_id:b.bookId,page,total_pages,updated_at:new Date().toISOString()},headers:{Prefer:'resolution=merge-duplicates'}});return {saved:true};
 }
 if(action==='market-review'&&method==='POST'){
   await entitled(u,b.bookId);const rating=Number(b.rating),text=clean(b.body,2000);
   if(!Number.isInteger(rating)||rating<1||rating>5||text.length<10)throw new HttpError(400,'Weka alama na andika maoni yenye angalau herufi 10.');
   await supa('/rest/v1/akili_reviews?on_conflict=user_id,book_id',{method:'POST',body:{user_id:u.id,book_id:b.bookId,rating,body:text,status:'pending'},headers:{Prefer:'resolution=merge-duplicates'}});return {saved:true};
 }
 if(action==='market-notifications'&&method==='GET')return {notifications:await rows('akili_notifications','select=*&'+eq('user_id',u.id)+'&order=created_at.desc&limit=60')};
 if(action==='market-notifications-read'&&method==='POST'){await patch('akili_notifications',eq('user_id',u.id)+'&read_at=is.null',{read_at:new Date().toISOString()});return {saved:true};}
 if(action==='market-support'&&method==='GET')return {tickets:await rows('akili_support_tickets','select=*&'+eq('user_id',u.id)+'&order=created_at.desc&limit=50')};
 if(action==='market-support'&&method==='POST'){
   const subject=clean(b.subject,160),message=clean(b.message,4000);if(subject.length<3||message.length<10)throw new HttpError(400,'Jaza kichwa na maelezo ya ombi.');
   const recent=await rows('akili_support_tickets','select=id&'+eq('user_id',u.id)+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&limit=5');
   if(recent.length>=5)throw new HttpError(429,'Maombi yako yamepokelewa. Subiri majibu kabla ya kutuma mengine.');
   await insert('akili_support_tickets',{user_id:u.id,subject,message});return {saved:true};
 }
 if(action==='market-accept-invite'&&method==='POST'){
   if(!/^[a-f0-9]{64}$/.test(b.token||''))throw new HttpError(400,'Mwaliko si sahihi.');
   await supa('/rest/v1/rpc/akili_accept_invitation',{method:'POST',body:{p_user_id:u.id,p_token_hash:sha(b.token)}});await audit(u,'author.accepted');try{await authorVerifiedSms(u.id);}catch(error){console.error('Author verification SMS unavailable',error?.name||'provider_error');}return {accepted:true};
 }
 if(action==='market-accept-email-invite'&&method==='POST'){
   const invite=await one('akili_author_invitations',eq('id',uuid(b.id)));
   if(!invite||invite.email.toLowerCase()!==u.email.toLowerCase()||invite.accepted_at||Date.parse(invite.expires_at)<=Date.now())throw new HttpError(403,'Mwaliko huu haujaidhinishwa kwa email yako au umeisha.');
   await supa('/rest/v1/rpc/akili_accept_invitation',{method:'POST',body:{p_user_id:u.id,p_token_hash:invite.token_hash}});
   await audit(u,'author.accepted',invite.id);try{await authorVerifiedSms(u.id);}catch(error){console.error('Author verification SMS unavailable',error?.name||'provider_error');}return {accepted:true};
 }
 if(action==='market-author-data'&&method==='GET'){
   authorizeAuthor(u);
   const [books,ledgerRows,withdrawals,settings]=await Promise.all([rows('ebook_books','select=*&'+eq('author_id',u.id)+'&order=created_at.desc'),rows('akili_ledger','select=order_id,amount_tzs,created_at&'+eq('author_id',u.id)+'&account=in.(author,author_adjustment,author_reversal)&order=created_at.desc'),rows('akili_withdrawals','select=*&'+eq('user_id',u.id)+'&order=created_at.desc'),one('ebook_site_settings','id=eq.1','withdrawal_min_tzs,withdrawal_fee_tzs')]);
   const customerOrders=books.length?await rows('ebook_orders','select=id,book_id,customer_name,customer_email,customer_phone,amount_tzs,currency,status,created_at,paid_at&book_id=in.('+books.map(x=>x.id).join(',')+')&status=in.(paid,pending,failed)&order=created_at.desc&limit=1000'):[];
   const sales=new Map();for(const entry of ledgerRows.filter(x=>x.order_id)){const prior=sales.get(entry.order_id);if(prior){prior.amount_tzs+=entry.amount_tzs;if(Date.parse(entry.created_at)<Date.parse(prior.created_at))prior.created_at=entry.created_at;}else sales.set(entry.order_id,{...entry});}
   const ledger=[...sales.values()],earned=ledger.reduce((s,x)=>s+x.amount_tzs,0)+ledgerRows.filter(x=>x.account==='author_adjustment').reduce((s,x)=>s+x.amount_tzs,0)-ledgerRows.filter(x=>x.account==='author_reversal').reduce((s,x)=>s+x.amount_tzs,0),reserved=withdrawals.filter(x=>x.status!=='declined').reduce((s,x)=>s+x.amount_tzs,0);
   return {books:books.map(x=>({...x,cover_url:assetUrl(x.cover_path)})),ledger,customerOrders,withdrawals,balance:{earned,available:earned-reserved,pending:withdrawals.filter(x=>x.status==='pending').reduce((s,x)=>s+x.amount_tzs,0),withdrawn:withdrawals.filter(x=>x.status==='paid').reduce((s,x)=>s+x.amount_tzs-x.fee_tzs,0)},policy:{...settings,withdrawal_min_tzs:2001,withdrawal_fee_tzs:2000}};
 }
 if(action==='market-save-book'&&method==='POST'){
   authorizeAuthor(u);const existing=b.id?await ownBook(u,b.id):null;
   if(existing?.status==='published'&&!u.isAdmin)throw new HttpError(409,'Kitabu kimechapishwa. Wasiliana na admin kuomba marekebisho.');
   if(!b.slug&&b.title)b.slug=clean(b.title,200).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'');
   const v=bookValues(b);if(!v.title||!v.slug||v.price_tzs===undefined)throw new HttpError(400,'Jaza jina, kiungo na bei.');
   const collision=await one('ebook_books',eq('slug',v.slug),'id');if(collision&&collision.id!==existing?.id)throw new HttpError(409,'Kiungo hiki kimetumika. Ongeza neno jingine kwenye kiungo.');
   const id=existing?.id||crypto.randomUUID();
   for(const k of ['pdf_path','cover_path','preview_path'])if(!u.isAdmin&&v[k]&&!v[k].startsWith(id+'/'))throw new HttpError(403,'Faili halihusiani na kitabu hiki.');
   v.updated_at=new Date().toISOString();v.author_id=existing?.author_id||u.id;v.author_name=v.author_name||existing?.author_name||u.profile.display_name;v.status=existing?.status==='published'?'published':'draft';
   if(v.status==='published')Object.assign(v,await validatePublication({...existing,...v}));
   if(existing)await insert('akili_product_versions',{book_id:id,actor_id:u.id,snapshot:existing});
   const result=existing?await patch('ebook_books',eq('id',id),v):await insert('ebook_books',{id,...v});
   await audit(u,'book.saved',id);return {book:result[0]};
 }
 if(action==='market-submit-book'&&method==='POST'){
   const book=await ownBook(u,b.id);
   if(book.status==='published')return {published:true,already_published:true};
   if(!['draft','changes_requested','rejected','submitted'].includes(book.status))throw new HttpError(409,'Rejesha kitabu kwenye rasimu kabla ya kukichapisha.');
   const verified=await validatePublication(book);
   await insert('akili_product_versions',{book_id:book.id,actor_id:u.id,snapshot:book});
   await patch('ebook_books',eq('id',book.id),{...verified,status:'published',moderation_note:'',updated_at:new Date().toISOString()});
   await audit(u,'book.published',book.id,{self_published:true});
   await notify(u.id,'Kitabu chako kipo dukani',book.title,'/book/'+book.slug);
   return {published:true};
 }
 if(action==='market-upload'&&method==='POST'){
   authorizeAuthor(u);const kind=clean(b.kind,20);const book=await ownBook(u,b.bookId);
   if(!u.isAdmin&&!['draft','changes_requested','rejected','submitted'].includes(book.status))throw new HttpError(409,'Faili la kitabu hiki haliwezi kubadilishwa sasa.');
   const image=kind==='cover',bucket=image?'ebook-assets':kind==='pdf'?'ebook-pdfs':kind==='preview'?'ebook-previews':null;
   const mime=clean(b.mime,100).split(';')[0].trim().toLowerCase();
   const ext=image?({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[mime]:mime==='application/pdf'?'pdf':null;
   const max=kind==='pdf'?52428800:10485760;
   if(!bucket||!ext)throw new HttpError(400,'Tumia PNG, JPG au WebP kwa jalada, na PDF kwa kitabu.');
   if(!Number.isSafeInteger(b.size)||b.size<1||b.size>max)throw new HttpError(400,kind==='pdf'?'PDF kamili liwe hadi MB 50.':'Jalada au sampuli iwe hadi MB 10.');
   const path=book.id+'/'+crypto.randomUUID()+'.'+ext;
   const signed=await supa('/storage/v1/object/upload/sign/'+bucket+'/'+path,{method:'POST',body:{upsert:true}});
   if(!signed?.url)throw new HttpError(502,'Upload haijaandaliwa.');return {path,url:new URL('/storage/v1'+signed.url,process.env.SUPABASE_URL).href};
 }
 if(action==='market-complete-upload'&&method==='POST'){
   const book=await ownBook(u,b.bookId),kind=clean(b.kind,20),spec=uploadKinds[kind];
   if(!u.isAdmin&&!['draft','changes_requested','rejected','submitted'].includes(book.status))throw new HttpError(409,'Kitabu hiki kimechapishwa. Wasiliana na admin kuomba marekebisho.');
   if(!spec||typeof b.path!=='string'||!b.path.startsWith(book.id+'/')||!new RegExp('^'+book.id+'/[a-zA-Z0-9_-]+\\.(png|jpg|jpeg|webp|pdf)$').test(b.path))throw new HttpError(403,'Faili halihusiani na kitabu hiki.');
   const bytes=await storedBytes(spec.bucket,b.path,spec.max,kind==='cover'?'Jalada':kind==='pdf'?'PDF kamili':'Sampuli');
   let update={[spec.field]:b.path};
   if(kind==='cover')await verifyCover(bytes);
   else if(kind==='pdf')Object.assign(update,await pdfFiles({...book,pdf_path:b.path},{fullBytes:bytes,replacePreview:true}));
   else{
     if(!book.pdf_path)throw new HttpError(400,'Pakia PDF kamili kwanza. Sampuli itaandaliwa yenyewe.');
     Object.assign(update,await pdfFiles({...book,preview_path:b.path},{sampleBytes:bytes}));
   }
   update.updated_at=new Date().toISOString();
   await insert('akili_product_versions',{book_id:book.id,actor_id:u.id,snapshot:book});
   const result=await patch('ebook_books',eq('id',book.id),update);
   await audit(u,'book.file_uploaded',book.id,{kind});
   return {book:{...result[0],cover_url:assetUrl(result[0].cover_path)},preview_generated:!!update.preview_path&&(kind==='pdf'||kind==='preview'&&update.preview_path!==b.path)};
 }
 if(action==='market-inspect-file'&&method==='POST'){
   const book=await ownBook(u,b.bookId);if(!['pdf','preview'].includes(b.kind))throw new HttpError(400,'Faili si sahihi.');
   const path=b.kind==='pdf'?book.pdf_path:book.preview_path;if(!path)throw new HttpError(404,'Faili halipo.');return {url:await signFile(b.kind==='pdf'?'ebook-pdfs':'ebook-previews',path,300)};
 }
 if(action==='market-withdraw'&&method==='POST'){
   authorizeAuthor(u);const amount=Number(b.amount_tzs);let phone=clean(b.phone,25).replace(/[^0-9]/g,'');if(phone.startsWith('0'))phone='255'+phone.slice(1);
   if(!Number.isSafeInteger(amount)||!/^255\d{9}$/.test(phone))throw new HttpError(400,'Jaza kiasi na namba sahihi.');
   const result=await supa('/rest/v1/rpc/akili_request_withdrawal',{method:'POST',body:{p_user_id:u.id,p_amount:amount,p_phone:phone}});await audit(u,'withdrawal.requested',String(result));return {requested:true};
 }
 if(!action.startsWith('market-admin-'))throw new HttpError(404,'Huduma haijapatikana.');
 if(!u.isAdmin)throw new HttpError(403,'Huna ruhusa ya admin.');
 if(action==='market-admin-author-balance'&&(method==='GET'||method==='POST')){
    const authorId=uuid(b.userId),profile=await one('akili_profiles',eq('user_id',authorId));
    if(!profile||profile.role!=='author')throw new HttpError(404,'Mwandishi hajapatikana.');
    const [ledger,withdrawals]=await Promise.all([
      rows('akili_ledger','select=account,amount_tzs&'+eq('author_id',authorId)+'&account=in.(author,author_adjustment,author_reversal)'),
      rows('akili_withdrawals','select=amount_tzs,fee_tzs,status&'+eq('user_id',authorId))
    ]);
    const earned=ledger.reduce((s,x)=>s+(x.account==='author_reversal'?-x.amount_tzs:x.amount_tzs),0);
    const reserved=withdrawals.filter(x=>['pending','paid'].includes(x.status)).reduce((s,x)=>s+x.amount_tzs,0);
    return {author:{user_id:authorId,display_name:profile.display_name,email:profile.email},earned,available:earned-reserved,reserved,withdrawn:withdrawals.filter(x=>x.status==='paid').reduce((s,x)=>s+x.amount_tzs-x.fee_tzs,0)};
  }
  if(action==='market-admin-author-balance'&&method==='POST'){
    const authorId=uuid(b.userId),target=Number(b.target_balance_tzs),reason=clean(b.reason,1000);
    if(!Number.isSafeInteger(target)||target<0||target>2000000000||reason.length<8)throw new HttpError(400,'Weka salio sahihi na sababu yenye angalau herufi 8.');
    const profile=await one('akili_profiles',eq('user_id',authorId));
    if(!profile||profile.role!=='author')throw new HttpError(404,'Mwandishi hajapatikana.');
    const [ledger,withdrawals]=await Promise.all([
      rows('akili_ledger','select=account,amount_tzs&'+eq('author_id',authorId)+'&account=in.(author,author_adjustment,author_reversal)'),
      rows('akili_withdrawals','select=amount_tzs,status&'+eq('user_id',authorId))
    ]);
    const current=ledger.reduce((s,x)=>s+(x.account==='author_reversal'?-x.amount_tzs:x.amount_tzs),0);
    const reserved=withdrawals.filter(x=>['pending','paid'].includes(x.status)).reduce((s,x)=>s+x.amount_tzs,0);
    if(target<reserved)throw new HttpError(409,'Salio jipya haliwezi kuwa chini ya fedha zilizokwishaombwa au kulipwa.');
    const delta=target-current;
    if(!delta)return {saved:true,unchanged:true,balance:current};
    await insert('akili_ledger',{order_id:null,author_id:authorId,account:delta>0?'author_adjustment':'author_reversal',amount_tzs:Math.abs(delta)});
    await audit(u,'author.balance_adjusted',authorId,{previous_balance_tzs:current,new_balance_tzs:target,delta_tzs:delta,reason});
    await notify(authorId,'Salio lako limefanyiwa marekebisho',`Admin amebadilisha salio lako kwa TSh ${Math.abs(delta).toLocaleString('en-US')}. Sababu: ${reason}`,'/sales-analytics');
    return {saved:true,balance:target,delta};
  }
 if(action==='market-admin-data'&&method==='GET'){
   const [books,profiles,orders,withdrawals,tickets,reviews,audits,settings,ledger,invitations,admins,author_links]=await Promise.all([
     rows('ebook_books','select=*&order=created_at.desc'),rows('akili_profiles','select=*&order=created_at.desc&limit=300'),
     rows('ebook_orders','select=id,book_id,customer_name,customer_email,customer_phone,amount_tzs,status,created_at,paid_at,verification_test&order=created_at.desc&limit=300'),
     rows('akili_withdrawals','select=*&order=created_at.desc&limit=200'),rows('akili_support_tickets','select=*&order=created_at.desc&limit=200'),
     rows('akili_reviews','select=*&order=created_at.desc&limit=200'),rows('akili_audit_logs','select=*&order=created_at.desc&limit=100'),
     one('ebook_site_settings','id=eq.1'),rows('akili_ledger','select=*&order=created_at.desc&limit=1000'),rows('akili_author_invitations','select=id,email,expires_at,accepted_at,email_sent_at,created_at&order=created_at.desc&limit=100'),rows('ebook_admins','select=user_id'),experienceReady().then(ready=>ready?rows('akili_author_links','select=id,label,created_at,expires_at,use_limit,uses,revoked_at&order=created_at.desc&limit=100'):[])]);
   return {books:books.map(x=>({...x,cover_url:assetUrl(x.cover_path)})),profiles:profiles.map(p=>({...p,role:admins.some(a=>a.user_id===p.user_id)?'admin':p.role})),orders,withdrawals,tickets,reviews,audits,settings,ledger,invitations,author_links,experience_ready:await experienceReady(),
     integration:{database:true,storage:!!process.env.SUPABASE_SERVICE_ROLE_KEY,snippe:!!process.env.SNIPPE_API_KEY,webhook:!!process.env.SNIPPE_WEBHOOK_SECRET,payments_enabled:process.env.SNIPPE_PAYMENTS_ENABLED==='true',email:!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM)}};
 }
 if(action==='market-admin-moderate'&&method==='POST'){
   const book=await one('ebook_books',eq('id',uuid(b.id)));if(!book)throw new HttpError(404,'Kitabu hakipo.');
   if(!['published','changes_requested','rejected','archived','draft'].includes(b.status))throw new HttpError(400,'Uamuzi si sahihi.');
   if(b.status==='published'&&book.status==='published'&&!b.changes)return {saved:true,already_published:true};
   const note=clean(b.note,2000);if(['changes_requested','rejected'].includes(b.status)&&note.length<5)throw new HttpError(400,'Andika sababu ya uamuzi.');
   const changes=b.status==='published'&&b.changes?bookValues(b.changes):{};
   if(changes.slug&&changes.slug!==book.slug){const collision=await one('ebook_books',eq('slug',changes.slug),'id');if(collision&&collision.id!==book.id)throw new HttpError(409,'Kiungo hiki kimetumika. Ongeza neno jingine kwenye kiungo.');}
   const verified=b.status==='published'?await validatePublication({...book,...changes}):null;
   await insert('akili_product_versions',{book_id:book.id,actor_id:u.id,snapshot:book});
   await patch('ebook_books',eq('id',book.id),{...changes,...verified,status:b.status,moderation_note:note,updated_at:new Date().toISOString()});
   await audit(u,'book.'+b.status,book.id,{note});await notify(book.author_id,'Uamuzi kuhusu kitabu chako',book.title+' — '+(note||b.status),'/author/books');try{await emailAuthorBookDecision({...book,...changes,updated_at:new Date().toISOString()},b.status,note);}catch(error){console.error('Author book activity email unavailable',error?.name||'provider_error');}return {saved:true};
 }
 if(action==='market-admin-invite'&&method==='POST'){
   const email=clean(b.email,160).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Email si sahihi.');
   const recent=await rows('akili_author_invitations','select=id&'+eq('email',email)+'&created_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString()));
   if(recent.length>=3)throw new HttpError(429,'Mialiko ya email hii tayari imetumwa. Subiri kabla ya kujaribu tena.');
   siteOrigin();
   const token=randomToken();const invite=await insert('akili_author_invitations',{email,token_hash:sha(token),invited_by:u.id});
   let email_sent=false;try{email_sent=await emailInvitation(email,token,invite[0].id);}catch{console.error('Author invitation email not confirmed');}
   await audit(u,'author.invited',invite[0].id,{email,email_sent});return {token,email,email_sent,email_type:emailConfigured()?'invitation':'auth_link',email_configured:invitationEmailConfigured()};
 }
 if(action==='market-admin-sms-data'&&method==='GET'){
   const campaigns=await rows('akili_sms_campaigns','select=*&order=created_at.desc&limit=60');
   const totals=campaigns.length?await rows('akili_sms_delivery_totals','select=*&campaign_id=in.('+campaigns.map(c=>c.id).join(',')+')'):[];
   return {...smsStatus(await smsConfig()),campaigns:campaigns.map(({recipients,fingerprint,...c})=>({...c,recipient_count:recipients.length,delivered:totals.find(t=>t.campaign_id===c.id)?.delivered||0,failed:totals.find(t=>t.campaign_id===c.id)?.failed||0}))};
 }
 if(action==='market-admin-sms-connect'&&method==='POST'){
   const result=await connectSmsApi(u,b);await audit(u,'sms.api_configured',u.id);return result;
 }
 if(action==='market-admin-sms-webhook'&&method==='POST'){
   const result=await connectSmsWebhook(u,b);await audit(u,'sms.webhook_configured',u.id);return result;
 }
 if(action==='market-admin-sms-preview'&&method==='POST')return {...bulkValues(b),configured:await smsConfigured()};
 if(action==='market-admin-sms-account'&&method==='GET')return smsAccount();
 if(action==='market-admin-sms-send'&&method==='POST'){
   const result=await sendBulk(u,b);await audit(u,'sms.submitted',result.campaign.id,{recipients:result.campaign.recipients.length});return {accepted:result.campaign.status==='accepted'};
 }
 if(action==='market-admin-user'&&method==='POST'){
   const id=uuid(b.userId);if(id===u.id||await one('ebook_admins',eq('user_id',id)))throw new HttpError(409,'Huwezi kusitisha akaunti ya admin.');
   if(!['active','restricted'].includes(b.status))throw new HttpError(400,'Hali si sahihi.');
   await patch('akili_profiles',eq('user_id',id),{status:b.status});await audit(u,'user.'+b.status,id);return {saved:true};
 }
 if(action==='market-admin-review'&&method==='POST'){
   if(!['published','rejected'].includes(b.status))throw new HttpError(400,'Uamuzi si sahihi.');await patch('akili_reviews',eq('id',uuid(b.id)),{status:b.status});await audit(u,'review.'+b.status,b.id);return {saved:true};
 }
 if(action==='market-admin-support'&&method==='POST'){
   const reply=clean(b.reply,4000);if(reply.length<3)throw new HttpError(400,'Andika jibu.');
   const ticket=await one('akili_support_tickets',eq('id',uuid(b.id)));if(!ticket)throw new HttpError(404,'Ombi halipo.');
   await patch('akili_support_tickets',eq('id',ticket.id),{reply,status:'resolved',updated_at:new Date().toISOString()});await notify(ticket.user_id,'Msaada umejibu ombi lako',ticket.subject,'/help');await audit(u,'support.replied',ticket.id);return {saved:true};
 }
 if(action==='market-admin-withdrawal'&&method==='POST'){
   if(!['paid','declined'].includes(b.status))throw new HttpError(400,'Uamuzi si sahihi.');
   const reference=clean(b.reference,160),note=clean(b.note,1000);
   if(b.status==='paid'&&reference.length<5)throw new HttpError(400,'Weka reference ya malipo yaliyokamilika.');
   if(b.status==='declined'&&note.length<5)throw new HttpError(400,'Andika sababu.');
   const result=await patch('akili_withdrawals',eq('id',uuid(b.id))+'&status=eq.pending',{status:b.status,reference,note,processed_at:new Date().toISOString()});
   if(!result.length)throw new HttpError(409,'Ombi hili tayari limeshughulikiwa.');await audit(u,'withdrawal.'+b.status,b.id,{reference,note});await notify(result[0].user_id,'Hali ya ombi la kutoa pesa',b.status==='paid'?'Ombi lako limelipwa.':'Ombi lako limekataliwa: '+note,'/withdrawal-request');return {saved:true};
 }
 if(action==='market-admin-settings'&&method==='POST'){
   const v={support_email:clean(b.support_email,160),contact:clean(b.contact,500),about_author:clean(b.about_author,10000),contents:clean(b.contents,10000),published_at:new Date().toISOString()};
   if(!/^#[a-f0-9]{6}$/i.test(b.primary_color)||!/^\S+@\S+\.\S+$/.test(v.support_email))throw new HttpError(400,'Kichwa, rangi au email si sahihi.');
   if(await experienceReady())v.appearance=appearance({design:b.design,mode:b.mode});
   v.primary_color=b.primary_color;await patch('ebook_site_settings','id=eq.1',v);await audit(u,'settings.updated');return {saved:true};
 }
 throw new HttpError(404,'Huduma haijapatikana.');
}
