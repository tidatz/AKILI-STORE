import crypto from 'node:crypto';
import {HttpError,clean,isUuid,sha,randomToken,supa,rows,one,insert,patch,eq,assetUrl,signFile,adminUser} from './lib.mjs';
import {smsConfigured,emailConfigured,invitationEmailConfigured,bulkValues,sendBulk,smsAccount,connectSmsApi,connectSmsWebhook,emailInvitation,siteOrigin} from './communications.mjs';
import {smsConfig,smsStatus} from './sms-config.mjs';

const uuid=value=>{if(!isUuid(value))throw new HttpError(400,'Kitambulisho si sahihi.');return value;};
const body=event=>{if((event.body||'').length>40000)throw new HttpError(413,'Taarifa ni nyingi.');try{return JSON.parse(event.body||'{}');}catch{throw new HttpError(400,'Taarifa si sahihi.');}};
const publicBook=b=>({id:b.id,slug:b.slug,title:b.title,subtitle:b.subtitle,description:b.description,price_tzs:b.price_tzs,cover_url:assetUrl(b.cover_path),author_name:b.author_name,category:b.category,language:b.language,page_count:b.page_count,has_preview:!!b.preview_path});
const safeUser=u=>({id:u.id,email:u.email,display_name:u.profile.display_name,phone:u.profile.phone,bio:u.profile.bio,role:u.isAdmin?'admin':u.profile.role,status:u.profile.status});
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
 if(u.profile.status!=='active')throw new HttpError(403,'Akaunti hii imesitishwa. Wasiliana na msaada.');
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
async function entitled(u,id){
 const access=await one('akili_entitlements',eq('user_id',u.id)+'&'+eq('book_id',uuid(id))+'&revoked_at=is.null');
 if(!access)throw new HttpError(403,'Nunua kitabu hiki kwanza.');
 const order=await one('ebook_orders',eq('id',access.order_id));
 if(order?.status!=='paid'||order.user_id!==u.id)throw new HttpError(403,'Malipo hayajathibitishwa.');
 return access;
}
async function existsFile(bucket,path){
 if(!path)return false;
 try{await signFile(bucket,path,60);return true;}catch{return false;}
}
export async function validatePublication(b){
 if(!b.title?.trim()||!b.author_id||!b.author_name?.trim()||!b.category?.trim()||!Number.isSafeInteger(b.price_tzs)||b.price_tzs<500||!b.cover_path||!b.pdf_path||!b.preview_path)
   throw new HttpError(400,'Kamilisha jina, mwandishi, kundi, bei, jalada, PDF na sampuli kabla ya kuchapisha.');
 const [cover,pdf,preview]=await Promise.all([existsFile('ebook-assets',b.cover_path),existsFile('ebook-pdfs',b.pdf_path),existsFile('ebook-previews',b.preview_path)]);
 if(!cover||!pdf||!preview)throw new HttpError(400,'Jalada, PDF au sampuli haijakamilika kupakiwa.');
 const author=await one('akili_profiles',eq('user_id',b.author_id));
 if(!author||author.status!=='active'||(author.role!=='author'&&!await one('ebook_admins',eq('user_id',b.author_id))))
   throw new HttpError(400,'Mwandishi lazima awe na akaunti iliyoidhinishwa na inayofanya kazi.');
 try {
   const {PDFDocument}=await import('pdf-lib');
   const [fullUrl,sampleUrl]=await Promise.all([signFile('ebook-pdfs',b.pdf_path,60),signFile('ebook-previews',b.preview_path,60)]);
   const [fullResponse,sampleResponse]=await Promise.all([fetch(fullUrl,{signal:AbortSignal.timeout(20000)}),fetch(sampleUrl,{signal:AbortSignal.timeout(20000)})]);
   if(!fullResponse.ok||!sampleResponse.ok)throw Error('download');
   const [fullBytes,sampleBytes]=await Promise.all([fullResponse.arrayBuffer(),sampleResponse.arrayBuffer()]);
   const [fullDoc,sampleDoc]=await Promise.all([PDFDocument.load(fullBytes),PDFDocument.load(sampleBytes)]);
   if(sampleDoc.getPageCount()>4||sampleDoc.getPageCount()<1||sampleDoc.getPageCount()>=fullDoc.getPageCount())
     throw new HttpError(400,'Sampuli iwe hadi kurasa nne na iwe fupi kuliko kitabu kamili.');
 } catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'PDF au sampuli haifunguki vizuri. Hakikisha faili ni PDF halisi lisilofungwa kwa nenosiri.');}
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
 if(action==='catalog'&&method==='GET'){
   const [books,settings]=await Promise.all([rows('ebook_books','select=*&status=eq.published&order=featured.desc,created_at.desc&limit=250'),one('ebook_site_settings','id=eq.1')]);
   return {books:books.map(publicBook),settings:{site_name:'AKILI STORE',hero_title:settings?.hero_title,hero_description:settings?.hero_description,primary_color:settings?.primary_color,contact:settings?.contact,support_email:settings?.support_email,about_author:settings?.about_author,about_book:settings?.about_book,contents:settings?.contents,author_avatar:assetUrl(settings?.logo_path)},payments_enabled:process.env.SNIPPE_PAYMENTS_ENABLED==='true'};
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
 if(!action.startsWith('market-'))return undefined;
 const u=await currentUser(event),b=method==='POST'?body(event):{};
 if(action==='market-me'&&method==='GET'){
   const pending=!u.isAdmin&&u.profile.role==='reader'?await one('akili_author_invitations',eq('email',u.email.toLowerCase())+'&accepted_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.desc','id'):null;
   return {user:{...safeUser(u),author_invitation:pending?.id||null}};
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
   for(const o of orders)await supa('/rest/v1/akili_entitlements',{method:'POST',body:{user_id:u.id,book_id:o.book_id,order_id:o.id},headers:{Prefer:'resolution=ignore-duplicates'}});
   const [access,progress]=await Promise.all([rows('akili_entitlements','select=book_id,created_at&'+eq('user_id',u.id)+'&revoked_at=is.null'),rows('akili_reading_progress','select=book_id,page,total_pages&'+eq('user_id',u.id))]);
   const paid=new Set(orders.map(o=>o.book_id));const books=[];
   for(const a of access){if(!paid.has(a.book_id))continue;const book=await one('ebook_books',eq('id',a.book_id));if(book)books.push({...publicBook(book),purchased_at:a.created_at,progress:progress.find(p=>p.book_id===book.id)||null});}
   return {books};
 }
 if(action==='market-orders'&&method==='GET')return {orders:await rows('ebook_orders','select=id,book_id,amount_tzs,currency,status,created_at,paid_at,verification_test&'+eq('user_id',u.id)+'&order=created_at.desc&limit=200')};
 if(action==='market-access'&&method==='POST'){
   const a=await entitled(u,b.bookId),book=await one('ebook_books',eq('id',a.book_id));
   if(!book?.pdf_path)throw new HttpError(404,'PDF haipatikani. Tafadhali wasiliana na msaada.');
   const progress=await one('akili_reading_progress',eq('user_id',u.id)+'&'+eq('book_id',book.id));
   await insert('ebook_access_events',{order_id:a.order_id,event_type:b.purpose==='download'?'download_request':'reader_open'});
   return {title:book.title,url:await signFile('ebook-pdfs',book.pdf_path,300),filename:book.slug+'.pdf',page:progress?.page||1};
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
   await supa('/rest/v1/rpc/akili_accept_invitation',{method:'POST',body:{p_user_id:u.id,p_token_hash:sha(b.token)}});await audit(u,'author.accepted');return {accepted:true};
 }
 if(action==='market-accept-email-invite'&&method==='POST'){
   const invite=await one('akili_author_invitations',eq('id',uuid(b.id)));
   if(!invite||invite.email.toLowerCase()!==u.email.toLowerCase()||invite.accepted_at||Date.parse(invite.expires_at)<=Date.now())throw new HttpError(403,'Mwaliko huu haujaidhinishwa kwa email yako au umeisha.');
   await supa('/rest/v1/rpc/akili_accept_invitation',{method:'POST',body:{p_user_id:u.id,p_token_hash:invite.token_hash}});
   await audit(u,'author.accepted',invite.id);return {accepted:true};
 }
 if(action==='market-author-data'&&method==='GET'){
   authorizeAuthor(u);
   const [books,ledger,withdrawals,settings]=await Promise.all([rows('ebook_books','select=*&'+eq('author_id',u.id)+'&order=created_at.desc'),rows('akili_ledger','select=order_id,amount_tzs,created_at&account=eq.author&'+eq('author_id',u.id)+'&order=created_at.desc'),rows('akili_withdrawals','select=*&'+eq('user_id',u.id)+'&order=created_at.desc'),one('ebook_site_settings','id=eq.1','withdrawal_min_tzs,withdrawal_fee_tzs')]);
   const earned=ledger.reduce((s,x)=>s+x.amount_tzs,0),reserved=withdrawals.filter(x=>x.status!=='declined').reduce((s,x)=>s+x.amount_tzs,0);
   return {books:books.map(x=>({...x,cover_url:assetUrl(x.cover_path)})),ledger,withdrawals,balance:{earned,available:earned-reserved,pending:withdrawals.filter(x=>x.status==='pending').reduce((s,x)=>s+x.amount_tzs,0),withdrawn:withdrawals.filter(x=>x.status==='paid').reduce((s,x)=>s+x.amount_tzs-x.fee_tzs,0)},policy:settings};
 }
 if(action==='market-save-book'&&method==='POST'){
   authorizeAuthor(u);const existing=b.id?await ownBook(u,b.id):null;
   if(existing?.status==='submitted'&&!u.isAdmin)throw new HttpError(409,'Kitabu kinakaguliwa. Subiri uamuzi wa admin.');
   if(existing?.status==='published'&&!u.isAdmin)throw new HttpError(409,'Kitabu kimechapishwa. Wasiliana na admin kuomba marekebisho.');
   const v=bookValues(b);if(!v.title||!v.slug||v.price_tzs===undefined)throw new HttpError(400,'Jaza jina, kiungo na bei.');
   const id=existing?.id||crypto.randomUUID();
   for(const k of ['pdf_path','cover_path','preview_path'])if(!u.isAdmin&&v[k]&&!v[k].startsWith(id+'/'))throw new HttpError(403,'Faili halihusiani na kitabu hiki.');
   v.updated_at=new Date().toISOString();v.author_id=existing?.author_id||u.id;v.author_name=v.author_name||existing?.author_name||u.profile.display_name;v.status=existing?.status==='published'?'published':'draft';
   if(v.status==='published')await validatePublication({...existing,...v});
   if(existing)await insert('akili_product_versions',{book_id:id,actor_id:u.id,snapshot:existing});
   const result=existing?await patch('ebook_books',eq('id',id),v):await insert('ebook_books',{id,...v});
   await audit(u,'book.saved',id);return {book:result[0]};
 }
 if(action==='market-submit-book'&&method==='POST'){
   const book=await ownBook(u,b.id);if(!['draft','changes_requested','rejected'].includes(book.status))throw new HttpError(409,'Kitabu hiki tayari kimewasilishwa au kuchapishwa.');
   await validatePublication(book);await patch('ebook_books',eq('id',book.id),{status:'submitted',moderation_note:'',updated_at:new Date().toISOString()});
   await audit(u,'book.submitted',book.id);const admins=await rows('ebook_admins','select=user_id');
   for(const a of admins)await notify(a.user_id,'Kitabu kipya cha kukagua',book.title,'/admin/books');return {submitted:true};
 }
 if(action==='market-upload'&&method==='POST'){
   authorizeAuthor(u);const kind=clean(b.kind,20);const book=await ownBook(u,b.bookId);
   if(!u.isAdmin&&!['draft','changes_requested','rejected'].includes(book.status))throw new HttpError(409,'Faili la kitabu hiki haliwezi kubadilishwa sasa.');
   const image=kind==='cover',bucket=image?'ebook-assets':kind==='pdf'?'ebook-pdfs':kind==='preview'?'ebook-previews':null;
   const ext=image?({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[b.mime]:b.mime==='application/pdf'?'pdf':null;
   const max=kind==='pdf'?52428800:10485760;
   if(!bucket||!ext||!Number.isSafeInteger(b.size)||b.size<1||b.size>max)throw new HttpError(400,'Chagua picha hadi MB 10 au PDF hadi MB 50 (sampuli MB 10).');
   const path=book.id+'/'+crypto.randomUUID()+'.'+ext;
   const signed=await supa('/storage/v1/object/upload/sign/'+bucket+'/'+path,{method:'POST',body:{}});
   if(!signed?.url)throw new HttpError(502,'Upload haijaandaliwa.');return {path,url:new URL('/storage/v1'+signed.url,process.env.SUPABASE_URL).href};
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
 if(action==='market-admin-data'&&method==='GET'){
   const [books,profiles,orders,withdrawals,tickets,reviews,audits,settings,ledger,invitations]=await Promise.all([
     rows('ebook_books','select=*&order=created_at.desc'),rows('akili_profiles','select=*&order=created_at.desc&limit=300'),
     rows('ebook_orders','select=id,book_id,customer_name,customer_email,customer_phone,amount_tzs,status,created_at,paid_at,verification_test&order=created_at.desc&limit=300'),
     rows('akili_withdrawals','select=*&order=created_at.desc&limit=200'),rows('akili_support_tickets','select=*&order=created_at.desc&limit=200'),
     rows('akili_reviews','select=*&order=created_at.desc&limit=200'),rows('akili_audit_logs','select=*&order=created_at.desc&limit=100'),
     one('ebook_site_settings','id=eq.1'),rows('akili_ledger','select=*&order=created_at.desc&limit=1000'),rows('akili_author_invitations','select=id,email,expires_at,accepted_at,email_sent_at,created_at&order=created_at.desc&limit=100')]);
   return {books:books.map(x=>({...x,cover_url:assetUrl(x.cover_path)})),profiles,orders,withdrawals,tickets,reviews,audits,settings,ledger,invitations,
     integration:{database:true,storage:!!process.env.SUPABASE_SERVICE_ROLE_KEY,snippe:!!process.env.SNIPPE_API_KEY,webhook:!!process.env.SNIPPE_WEBHOOK_SECRET,payments_enabled:process.env.SNIPPE_PAYMENTS_ENABLED==='true',email:!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM)}};
 }
 if(action==='market-admin-moderate'&&method==='POST'){
   const book=await one('ebook_books',eq('id',uuid(b.id)));if(!book)throw new HttpError(404,'Kitabu hakipo.');
   if(!['published','changes_requested','rejected','archived','draft'].includes(b.status))throw new HttpError(400,'Uamuzi si sahihi.');
   const note=clean(b.note,2000);if(['changes_requested','rejected'].includes(b.status)&&note.length<5)throw new HttpError(400,'Andika sababu ya uamuzi.');
   if(b.status==='published')await validatePublication(book);
   await insert('akili_product_versions',{book_id:book.id,actor_id:u.id,snapshot:book});
   await patch('ebook_books',eq('id',book.id),{status:b.status,moderation_note:note,updated_at:new Date().toISOString()});
   await audit(u,'book.'+b.status,book.id,{note});await notify(book.author_id,'Uamuzi kuhusu kitabu chako',book.title+' — '+(note||b.status),'/author/books');return {saved:true};
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
   v.primary_color=b.primary_color;await patch('ebook_site_settings','id=eq.1',v);await audit(u,'settings.updated');return {saved:true};
 }
 throw new HttpError(404,'Huduma haijapatikana.');
}
