import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';
const uid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const bookId='33333333-3333-4333-8333-333333333333';
const originalFetch=global.fetch;
const request=(action,body,token='reader-token')=>app.fetch(new Request('https://store.test/api?action='+action,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
async function mock(role,callback,overrides={}){
 const old={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
 Object.assign(process.env,{SUPABASE_URL:'https://database.test',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test'});
 const calls=[];
 global.fetch=async(url,opts={})=>{url=new URL(url);calls.push({path:url.pathname,query:url.search,opts});let result;
  if(overrides[url.pathname])result=await overrides[url.pathname](url,opts);
  else if(url.pathname==='/auth/v1/user')result={id:uid,email:'qa@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{role:'admin'}};
  else if(url.pathname==='/rest/v1/akili_profiles')result=[{user_id:uid,display_name:'QA',email:'qa@example.invalid',role,status:'active'}];
  else if(url.pathname==='/rest/v1/ebook_admins')result=[];
  else if(url.pathname==='/rest/v1/ebook_books')result=[{id:bookId,author_id:other,title:'Existing book',slug:'existing-book',price_tzs:25000,status:'draft',pdf_path:'private/full.pdf',preview_path:'sample.pdf',cover_path:'cover.png'}];
  else if(url.pathname==='/rest/v1/ebook_site_settings')result=[{site_name:'AKILI STORE'}];
  else result=[];
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{await callback(calls);}finally{global.fetch=originalFetch;for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('anonymous users cannot enter private library',async()=>{const r=await request('market-library',null,null);assert.equal(r.status,401);});
test('user-editable metadata cannot grant admin permission',async()=>mock('reader',async calls=>{const r=await request('market-admin-data');assert.equal(r.status,403);assert.equal(calls.some(c=>c.path==='/rest/v1/ebook_orders'),false);}));
test('reader cannot create or upload an author product',async()=>mock('reader',async()=>{assert.equal((await request('market-save-book',{title:'Title',slug:'title',price_tzs:5000})).status,403);assert.equal((await request('market-upload',{bookId,kind:'pdf',size:500,mime:'application/pdf'})).status,403);}));
test('author cannot edit another authors product',async()=>mock('author',async calls=>{const r=await request('market-save-book',{id:bookId,title:'Changed',slug:'changed',price_tzs:5000});assert.equal(r.status,403);assert.equal(calls.some(c=>c.opts.method==='PATCH'),false);}));
test('unpaid reader cannot obtain a protected file or write reading progress',async()=>mock('reader',async calls=>{assert.equal((await request('market-access',{bookId})).status,403);assert.equal((await request('market-progress',{bookId,page:1,total_pages:10})).status,403);assert.equal(calls.some(c=>c.path.startsWith('/storage')),false);}));
test('public catalog does not disclose private content paths',async()=>mock('reader',async()=>{const r=await request('catalog',null,null);assert.equal(r.status,200);const text=await r.text();assert.equal(text.includes('private/full.pdf'),false);assert.equal(text.includes('sample.pdf'),false);assert.equal(text.includes('server-test'),false);}));
test('auth user must have a confirmed email before library binding',async()=>mock('reader',async()=>{assert.equal((await request('market-library')).status,403);},{'/auth/v1/user':()=>({id:uid,email:'qa@example.invalid',email_confirmed_at:null})}));
test('revoked or non-paid entitlement never signs the full PDF',async()=>mock('reader',async calls=>{assert.equal((await request('market-access',{bookId})).status,403);assert.equal(calls.some(c=>c.path.startsWith('/storage')),false);},{'/rest/v1/akili_entitlements':()=>[{user_id:uid,book_id:bookId,order_id:other}],'/rest/v1/ebook_orders':()=>[{id:other,user_id:uid,status:'pending'}]}));
test('a verified reader can see and explicitly accept an invitation for their own email',async()=>mock('reader',async calls=>{
 const me=await (await request('market-me')).json();assert.equal(me.user.author_invitation,other);assert.equal(me.user.role,'reader');
 assert.equal((await request('market-accept-email-invite',{id:other})).status,200);
 const rpc=calls.find(c=>c.path==='/rest/v1/rpc/akili_accept_invitation');assert.ok(rpc);assert.equal(JSON.parse(rpc.opts.body).p_user_id,uid);
},{'/rest/v1/akili_author_invitations':()=>[{id:other,email:'qa@example.invalid',token_hash:'test-hash',accepted_at:null,expires_at:'2099-01-01'}]}));
test('a verified reader cannot claim another email invitation or an expired invitation',async()=>{
 for(const invite of [{email:'someone-else@example.invalid',expires_at:'2099-01-01'},{email:'qa@example.invalid',expires_at:'2000-01-01'}])await mock('reader',async calls=>{
  assert.equal((await request('market-accept-email-invite',{id:other})).status,403);assert.equal(calls.some(c=>c.path.includes('/rpc/')),false);
 },{'/rest/v1/akili_author_invitations':()=>[{id:other,token_hash:'test-hash',accepted_at:null,...invite}]});
});
