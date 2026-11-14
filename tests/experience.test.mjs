import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';
import {sha} from '../netlify/lib.mjs';
import {appearance} from '../netlify/experience.mjs';
import {publicBookLink,shareBook} from '../public/share.js';
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',bookId='33333333-3333-4333-8333-333333333333',orderId='44444444-4444-4444-8444-444444444444';
const secret='a'.repeat(64),token='b'.repeat(64);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const req=(a,b,auth=true)=>app.fetch(new Request('https://store.test/api?action='+a,{method:b?'POST':'GET',headers:{...(auth?{Authorization:'Bearer qa'}:{}),...(b?{'Content-Type':'application/json'}:{})},...(b?{body:JSON.stringify(b)}:{})}));
async function fixture(run,{admin=false,manual=false,paid=false,owner=null,revoked=false,deleted=false,restricted=false,overrides={}}={}){
 const original=global.fetch,env={SUPABASE_URL:'https://db.test',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',SITE_URL:'https://store.test'},prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const calls=[];global.fetch=async(input,opts={})=>{
   const u=new URL(input),path=u.pathname;calls.push({path,query:u.search,opts});let data;
   if(overrides[path])data=await overrides[path](u,opts);
   else if(path==='/auth/v1/user')data={id:actor,email:'qa@example.invalid',email_confirmed_at:'2026-01-01',user_metadata:{role:'admin'}};
   else if(path==='/rest/v1/akili_profiles')data=[{user_id:actor,email:'qa@example.invalid',display_name:'QA',role:'reader',status:restricted?'restricted':'active',deleted_at:deleted?'2026-01-01':null}];
   else if(path==='/rest/v1/ebook_admins')data=admin?[{user_id:actor}]:[];
   else if(path==='/rest/v1/akili_book_grants')data=manual?[{user_id:actor,book_id:bookId,revoked_at:null}]:[];
   else if(path==='/rest/v1/akili_entitlements')data=paid&&!revoked?[{user_id:actor,book_id:bookId,order_id:orderId}]:[];
   else if(path==='/rest/v1/ebook_orders')data=[{id:orderId,user_id:owner,book_id:bookId,status:paid?'paid':'pending',checkout_secret_hash:sha(secret),customer_email:'guest@example.invalid',amount_tzs:500}];
   else if(path==='/rest/v1/ebook_books')data=[{id:bookId,title:'Title " & <Book>',slug:'kitabu-cha-maarifa',author_name:'QA',price_tzs:500,status:'published',cover_path:'cover.webp',pdf_path:'private/full.pdf',preview_path:'private/sample.pdf'}];
   else if(path==='/rest/v1/ebook_access_tokens')data=[{order_id:orderId,revoked_at:null,expires_at:'2099-01-01'}];
   else if(path.startsWith('/storage/v1/object/sign/'))data={signedURL:'/object/sign/ebook-pdfs/private/full.pdf?token=mock-signed-only'};
   else if(path.startsWith('/rest/v1/rpc/'))data=true;
   else data=[];
   return data instanceof Response?data:json(data);
 };
 try{await run(calls);}finally{global.fetch=original;for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('manual access opens a private book and appears in the library without a paid order or financial insert',async()=>fixture(async calls=>{
 const r=await req('market-access',{bookId});assert.equal(r.status,200);assert.equal((await r.json()).slug,'kitabu-cha-maarifa');
 assert.equal((await (await req('market-library')).json()).books[0].access_source,'admin');
 assert.equal(calls.some(c=>c.path==='/rest/v1/ebook_orders'&&c.opts.method==='POST'),false);
 assert.equal(calls.some(c=>c.path==='/rest/v1/ebook_access_events'&&c.opts.method==='POST'),false);
 assert.ok(calls.some(c=>c.path==='/rest/v1/akili_audit_logs'&&c.opts.method==='POST'));
},{manual:true}));
test('deleted and restricted accounts cannot read books or use legacy admin functions',async()=>{
 for(const state of [{deleted:true},{restricted:true}])await fixture(async calls=>{
   assert.equal((await req('market-access',{bookId})).status,403);assert.equal((await req('admin-snippe-health')).status,403);
   assert.equal(calls.some(c=>c.path.startsWith('/storage/')),false);
 },{...state,admin:true,paid:true,owner:actor});
});
test('guest receipt requires its strong checkout capability and never exposes private paths',async()=>fixture(async calls=>{
 const r=await req('receipt',{orderId,clientSecret:secret},false);assert.equal(r.status,200);const v=await r.json();assert.equal(v.order.account_bound,false);assert.equal(v.book.pdf_path,undefined);
 assert.equal((await req('receipt',{orderId,clientSecret:'wrong'},false)).status,401);
 assert.equal((await req('claim',{orderId,clientSecret:'wrong'},false)).status,403);
 assert.equal(calls.some(c=>c.path.startsWith('/storage/')),false);
},{paid:true}));
test('pending guest purchases never produce a full PDF token',async()=>fixture(async calls=>{
 assert.equal((await req('claim',{orderId,clientSecret:secret},false)).status,403);
 assert.equal(calls.some(c=>c.path==='/rest/v1/ebook_access_tokens'),false);
}));
test('a revoked account entitlement blocks old capability tokens and prevents minting replacements',async()=>fixture(async calls=>{
 assert.equal((await req('access',{token},false)).status,403);assert.equal((await req('claim',{orderId,clientSecret:secret},false)).status,403);
 assert.equal(calls.some(c=>c.path.startsWith('/storage/')),false);
},{paid:true,owner:actor,revoked:true}));
test('a signed-in buyer cannot use a receipt belonging to another buyer',async()=>fixture(async()=>{
 assert.equal((await req('receipt',{orderId})).status,403);
},{paid:true,owner:other}));
test('readers cannot change roles, accounts, access or create author links',async()=>fixture(async calls=>{
 for(const action of ['market-admin-role','market-admin-account','market-admin-access','market-admin-author-link','market-admin-access-list'])assert.equal((await req(action,{userId:other,role:'admin',operation:'delete',bookId,grant:true})).status,403);
 assert.equal(calls.some(c=>c.path.startsWith('/rest/v1/rpc/')),false);
}));
test('admin role changes use the verified actor and reject the last active admin demotion',async()=>fixture(async calls=>{
 assert.equal((await req('market-admin-role',{userId:actor,role:'reader'})).status,409);
 const r=await req('market-admin-role',{userId:other,role:'author',actor:other});assert.equal(r.status,200);
 const body=JSON.parse(calls.find(c=>c.path==='/rest/v1/rpc/akili_manage_user').opts.body);assert.equal(body.p_actor,actor);assert.equal(body.p_user,other);assert.equal(body.p_value,'author');
},{admin:true}));
test('admins cannot delete or suspend themselves and access grants never change payment state',async()=>fixture(async calls=>{
 for(const operation of ['restricted','delete'])assert.equal((await req('market-admin-account',{userId:actor,operation})).status,409);
 assert.equal((await req('market-admin-access',{userId:other,bookId,grant:true})).status,200);
 assert.equal(calls.some(c=>c.path==='/rest/v1/ebook_orders'&&c.opts.method==='PATCH'),false);
 const value=JSON.parse(calls.find(c=>c.path==='/rest/v1/rpc/akili_manage_book_access').opts.body);assert.equal(value.p_actor,actor);assert.equal(value.p_grant,true);
},{admin:true}));
test('author link acceptance hashes the token and cannot grant admin from user input',async()=>fixture(async calls=>{
 assert.equal((await req('market-accept-author-link',{token,role:'admin'})).status,200);
 const value=JSON.parse(calls.find(c=>c.path==='/rest/v1/rpc/akili_accept_author_link').opts.body);assert.deepEqual(value,{p_user:actor,p_hash:sha(token)});
 assert.equal((await req('market-accept-author-link',{token:'invalid'})).status,400);
}));
test('expired, exhausted and revoked author links cannot be offered for registration',async()=>{
 for(const data of [{expires_at:'2000-01-01',uses:0,use_limit:1},{expires_at:'2099-01-01',uses:1,use_limit:1},{expires_at:'2099-01-01',revoked_at:'2026-01-01',uses:0,use_limit:1}])await fixture(async()=>assert.equal((await req('author-link',{token},false)).status,410),{overrides:{'/rest/v1/akili_author_links':()=>[data]}});
});
test('appearance accepts only the six designs and three modes',()=>{
 for(const design of ['classic','monochrome','glass','illustrative','soft','skeuomorphic'])for(const mode of ['normal','light','dark'])assert.deepEqual(appearance({design,mode}),{design,mode});
 for(const value of [{design:'evil',mode:'dark'},{design:'glass',mode:'javascript:'},null,[]])assert.throws(()=>appearance(value));
});
test('preferences update only the signed-in account and contain presentation values only',async()=>fixture(async calls=>{
 assert.equal((await req('market-preferences',{design:'glass',mode:'dark',role:'admin',userId:other})).status,200);
 const update=calls.find(c=>c.path==='/rest/v1/akili_profiles'&&c.opts.method==='PATCH');assert.ok(update.query.includes(actor));assert.deepEqual(JSON.parse(update.opts.body),{appearance:{design:'glass',mode:'dark'}});
 assert.equal((await req('market-preferences',{design:'evil',mode:'dark'})).status,400);
}));
test('public book previews include an escaped book name and cover, without private PDF URLs or buyer data',async()=>fixture(async()=>{
 const r=await req('book-page&slug=kitabu-cha-maarifa',null,false);assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('Title &quot; &amp; &lt;Book&gt; | AKILI STORE'));
 assert.ok(html.includes('https://store.test/book/kitabu-cha-maarifa'));assert.ok(html.includes('property="og:image"'));assert.equal(html.includes('private/full.pdf'),false);assert.equal(html.includes('guest@example.invalid'),false);
}));
test('sharing always creates a public named book link, even from a private reader token URL',async()=>{
 const l=Object.getOwnPropertyDescriptor(globalThis,'location'),n=Object.getOwnPropertyDescriptor(globalThis,'navigator');const shares=[];
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://store.test',href:'https://store.test/reader.html?token=private'}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async url=>shares.push(url)}}});
 try{const b={slug:'kitabu-cha-maarifa',title:'Maarifa'};assert.equal(publicBookLink(b.slug),'https://store.test/book/kitabu-cha-maarifa');assert.equal((await shareBook(b)).copied,true);assert.equal(shares[0].includes('token'),false);assert.throws(()=>publicBookLink('../reader.html'));}
 finally{for(const[k,d]of [['location',l],['navigator',n]]){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
});
