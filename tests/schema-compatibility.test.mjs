import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';
import {PDFDocument} from 'pdf-lib';
const user='11111111-1111-4111-8111-111111111111',bookId='22222222-2222-4222-8222-222222222222',orderId='33333333-3333-4333-8333-333333333333';
const readerSource=await PDFDocument.create();readerSource.addPage();const readerPdf=await readerSource.save();
test('pending database approval leaves existing purchases, admin data and local appearance usable',async()=>{
 const original=global.fetch,env={SUPABASE_URL:'https://old-db.test',SUPABASE_SERVICE_ROLE_KEY:'server-test',SUPABASE_PUBLISHABLE_KEY:'public-test'},prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),calls=[];Object.assign(process.env,env);
 global.fetch=async(input,opts={})=>{
   const u=new URL(input);calls.push({path:u.pathname,query:u.search,opts});let value=[];
   // Old schema deliberately lacks every newly proposed table and column.
   if(u.pathname==='/rest/v1/akili_author_links')return new Response(JSON.stringify({code:'PGRST205'}),{status:404});
   if(u.pathname==='/rest/v1/akili_book_grants'||u.search.includes('deleted_at')||u.search.includes('select=appearance'))throw Error('Attempted unapproved schema access');
   if(u.pathname==='/auth/v1/user')value={id:user,email:'qa@example.invalid',email_confirmed_at:'2026-01-01'};
   if(u.pathname==='/rest/v1/akili_profiles')value=[{user_id:user,email:'qa@example.invalid',display_name:'QA',role:'reader',status:'active'}];
   if(u.pathname==='/rest/v1/ebook_admins')value=[{user_id:user}];
   if(u.pathname==='/rest/v1/ebook_site_settings')value=[{site_name:'AKILI STORE'}];
   if(u.pathname==='/rest/v1/ebook_books')value=[{id:bookId,slug:'existing-book',title:'Existing book',price_tzs:500,status:'published',pdf_path:'private.pdf',cover_path:'cover.webp'}];
   if(u.pathname==='/rest/v1/ebook_orders')value=[{id:orderId,user_id:user,book_id:bookId,status:'paid',amount_tzs:500}];
   if(u.pathname==='/rest/v1/akili_entitlements')value=[{user_id:user,book_id:bookId,order_id:orderId}];
   if(u.pathname.startsWith('/storage/v1/object/sign/')&&opts.method==='POST')value={signedURL:u.pathname.replace('/storage/v1','')+'?token=mock'};
   if(u.pathname.startsWith('/storage/v1/object/ebook-reader-cache/'))value={Key:u.pathname};
   if(u.pathname.startsWith('/storage/v1/object/sign/')&&opts.method!=='POST')return new Response(readerPdf,{headers:{'Content-Type':'application/pdf'}});
   return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 };
 const request=(action,body)=>app.fetch(new Request('https://store.test/api?action='+action,{method:body?'POST':'GET',headers:{Authorization:'Bearer qa',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 try{
   const catalog=await request('catalog');assert.equal(catalog.status,200);assert.equal((await catalog.json()).experience_ready,false);
   assert.equal((await request('market-access',{bookId})).status,200);
   assert.equal((await request('receipt',{orderId})).status,200);
   assert.equal((await request('market-library')).status,200);
   assert.equal((await request('market-admin-data')).status,200);
   assert.equal((await request('admin-data')).status,200);
   const preferences=await request('market-preferences',{design:'glass',mode:'dark'});assert.equal(preferences.status,200);assert.equal((await preferences.json()).local_only,true);
   assert.equal((await request('market-admin-role',{userId:user,role:'author'})).status,503);
   assert.equal(calls.some(c=>c.path.includes('/rpc/')),false);
   assert.equal(calls.some(c=>c.path==='/rest/v1/akili_profiles'&&c.opts.method==='PATCH'),false);
   assert.equal(calls.filter(c=>c.path==='/rest/v1/akili_author_links').length,1);
 }finally{global.fetch=original;for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
