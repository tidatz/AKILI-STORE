import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import app from '../api/index.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const full=await PDFDocument.create();for(let i=0;i<7;i++)full.addPage();const pdf=await full.save();
const png=await sharp({create:{width:12,height:18,channels:3,background:'#1d4ed8'}}).png().toBuffer();
const baseBook={id,author_id:owner,author_name:'QA',title:'Maarifa',slug:'maarifa',category:'Biashara',price_tzs:500,cover_path:id+'/cover.png',pdf_path:id+'/full.pdf',preview_path:null,status:'draft'};
const req=(action,values)=>app.fetch(new Request('https://store.test/api?action='+action,{method:'POST',headers:{Authorization:'Bearer qa','Content-Type':'application/json'},body:JSON.stringify(values)}));
async function fixture(fn,{admin=false,role='author',author=owner,book=baseBook}={}){
 const oldFetch=global.fetch,env={SUPABASE_URL:'https://database.test',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private'},prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 let current={...book,author_id:author};const objects=new Map([['ebook-pdfs/'+id+'/full.pdf',pdf],['ebook-previews/'+id+'/sample.pdf',pdf],['ebook-assets/'+id+'/cover.png',png]]),patches=[],audit=[],notifications=[],writes=[];
 global.fetch=async(input,opts={})=>{
  const u=new URL(input),path=u.pathname,body=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):opts.body;
  if(path==='/auth/v1/user')return Response.json({id:owner,email:'qa@example.invalid',email_confirmed_at:'2026-01-01'});
  if(path==='/rest/v1/akili_profiles')return Response.json([{user_id:owner,email:'qa@example.invalid',display_name:'QA',role,status:'active'}]);
  if(path==='/rest/v1/ebook_admins')return Response.json(admin?[{user_id:owner}]:[]);
  if(path==='/rest/v1/ebook_books'){
   if(opts.method==='PATCH'){patches.push(body);current={...current,...body};return Response.json([current]);}
   if(u.searchParams.has('slug'))return Response.json(u.searchParams.get('slug')==='eq.'+current.slug?[current]:[]);
   return Response.json([current]);
  }
  if(path==='/rest/v1/akili_audit_logs'){audit.push(body);return Response.json([body]);}
  if(path==='/rest/v1/akili_notifications'){notifications.push(body);return Response.json([body]);}
  if(path==='/rest/v1/akili_product_versions')return Response.json([body]);
  if(path.startsWith('/storage/v1/object/upload/sign/'))return Response.json({url:path.replace('/storage/v1/object/upload/sign/','/object/upload/sign/')+'?token=upload'});
  if(opts.method==='POST'&&path.startsWith('/storage/v1/object/sign/'))return Response.json({signedURL:path.replace('/storage/v1','')});
  if(path.startsWith('/storage/v1/object/sign/')){const bytes=objects.get(path.slice('/storage/v1/object/sign/'.length));return bytes?new Response(bytes):new Response('',{status:404});}
  if(path.startsWith('/storage/v1/object/ebook-previews/')){const key=path.slice('/storage/v1/object/'.length);objects.set(key,body);writes.push(key);return Response.json({Key:key});}
  throw Error('Unexpected URL '+path);
 };
 try{await fn({objects,patches,audit,notifications,writes,current:()=>current});}finally{global.fetch=oldFetch;for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('attaching a full PDF saves only file fields, measures pages and creates a private sample',async()=>fixture(async d=>{
 const r=await req('market-complete-upload',{bookId:id,kind:'pdf',path:id+'/full.pdf',title:'Do not overwrite'});assert.equal(r.status,200,await r.clone().text());const result=await r.json();assert.equal(result.book.page_count,7);assert.equal(result.book.title,'Maarifa');assert.equal(result.book.status,'draft');assert.equal(d.patches[0].title,undefined);assert.equal(d.patches[0].pdf_path,id+'/full.pdf');assert.equal((await PDFDocument.load(d.objects.get('ebook-previews/'+result.book.preview_path))).getPageCount(),2);
}));
test('a cover upload attaches without requiring a full PDF or a separate form save',async()=>fixture(async d=>{
 const r=await req('market-complete-upload',{bookId:id,kind:'cover',path:id+'/cover.png'});assert.equal(r.status,200,await r.clone().text());assert.equal(d.patches.length,1);assert.equal(d.patches[0].cover_path,id+'/cover.png');assert.equal(d.writes.length,0);
},{book:{...baseBook,pdf_path:null}}));
test('manual full-book samples are automatically shortened before attachment',async()=>fixture(async d=>{
 const r=await req('market-complete-upload',{bookId:id,kind:'preview',path:id+'/sample.pdf'});assert.equal(r.status,200,await r.clone().text());const result=await r.json();assert.equal(result.preview_generated,true);assert.notEqual(result.book.preview_path,id+'/sample.pdf');assert.equal(d.current().status,'draft');
}));
test('upload completion rejects another book path and another author before any file write',async()=>{
 await fixture(async d=>{assert.equal((await req('market-complete-upload',{bookId:id,kind:'pdf',path:other+'/full.pdf'})).status,403);assert.equal(d.patches.length,0);});
 await fixture(async d=>{assert.equal((await req('market-complete-upload',{bookId:id,kind:'pdf',path:id+'/full.pdf'})).status,403);assert.equal(d.patches.length,0);},{author:other});
});
test('readers and authors of published books cannot replace live files',async()=>{
 for(const options of [{role:'reader'},{book:{...baseBook,status:'published'}}])await fixture(async d=>{assert.ok([403,409].includes((await req('market-upload',{bookId:id,kind:'pdf',mime:'application/pdf',size:pdf.length})).status));assert.equal(d.patches.length,0);},options);
});
test('the signed upload is book-scoped and permits retrying the same unique object',async()=>fixture(async()=>{
 const r=await req('market-upload',{bookId:id,kind:'pdf',mime:'application/pdf',size:pdf.length});assert.equal(r.status,200,await r.clone().text());const v=await r.json();assert.ok(v.path.startsWith(id+'/'));assert.ok(v.url.startsWith('https://database.test/storage/v1/object/upload/sign/ebook-pdfs/'+id+'/'));
}));
test('one moderation request saves editor changes and publishes after verifying files',async()=>fixture(async d=>{
 const r=await req('market-admin-moderate',{id,status:'published',changes:{title:'Jina lililoboreshwa',description:'Maelezo halisi',page_count:99}});assert.equal(r.status,200,await r.clone().text());assert.equal(d.patches.length,1);assert.equal(d.current().status,'published');assert.equal(d.current().page_count,7);assert.equal(d.current().title,'Jina lililoboreshwa');assert.ok(d.current().preview_path);assert.equal(d.notifications.length,1);
},{admin:true}));
test('repeating an already published moderation request is a no-op',async()=>fixture(async d=>{
 assert.equal((await req('market-admin-moderate',{id,status:'published'})).status,200);assert.equal(d.patches.length,0);assert.equal(d.notifications.length,0);assert.equal(d.writes.length,0);
},{admin:true,book:{...baseBook,status:'published'}}));
test('authors cannot use admin moderation and incomplete books are not published',async()=>{
 await fixture(async d=>{assert.equal((await req('market-admin-moderate',{id,status:'published'})).status,403);assert.equal(d.patches.length,0);});
 await fixture(async d=>{assert.equal((await req('market-admin-moderate',{id,status:'published'})).status,400);assert.equal(d.patches.length,0);},{admin:true,book:{...baseBook,pdf_path:null}});
});

test('an invited author publishes directly without an admin approval state',async()=>fixture(async d=>{
 const r=await req('market-submit-book',{id});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).published,true);assert.equal(d.current().status,'published');assert.equal(d.patches.length,1);assert.ok(d.current().preview_path);assert.ok(d.audit.some(a=>a.details?.self_published===true));
}));
test('previously submitted books can also publish without waiting for an admin',async()=>fixture(async d=>{
 const r=await req('market-submit-book',{id});assert.equal(r.status,200);assert.equal(d.current().status,'published');
},{book:{...baseBook,status:'submitted'}}));
test('incomplete author books stay unpublished and repeated publish clicks are idempotent',async()=>{
 await fixture(async d=>{assert.equal((await req('market-submit-book',{id})).status,400);assert.equal(d.patches.length,0);},{book:{...baseBook,cover_path:null}});
 await fixture(async d=>{assert.equal((await req('market-submit-book',{id})).status,200);assert.equal(d.patches.length,0);},{book:{...baseBook,status:'published'}});
});
