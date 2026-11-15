import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import {validatePublication} from '../netlify/marketplace.mjs';
const id='11111111-1111-4111-8111-111111111111';
const book={id,title:'Publication test',author_id:id,author_name:'QA',category:'Biashara',price_tzs:25000,cover_path:'cover.png',pdf_path:'full.pdf',preview_path:'sample.pdf'};
async function document(pages){const p=await PDFDocument.create();for(let i=0;i<pages;i++)p.addPage();return p.save();}
const png=await sharp({create:{width:12,height:18,channels:3,background:'#1d4ed8'}}).png().toBuffer();
async function run(sample,fn,{full,failed=false}={}){
 const oldFetch=global.fetch,env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'test-server'},old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));full??=await document(9);Object.assign(process.env,env);const generated=[];let downloads=0;
 global.fetch=async(url,opts={})=>{const u=new URL(url);
  if(u.pathname.includes('/rest/v1/akili_profiles'))return Response.json([{user_id:id,role:'author',status:'active'}]);
  if(opts.method==='POST'&&u.pathname.includes('/storage/v1/object/sign/'))return Response.json({signedURL:u.pathname.replace('/storage/v1','')});
  if(opts.method==='POST'&&u.pathname.includes('/storage/v1/object/ebook-previews/')){generated.push({path:u.pathname,bytes:opts.body});return Response.json({Key:u.pathname});}
  if(u.pathname.endsWith('/cover.png'))return new Response(png);
  if(u.pathname.endsWith('/sample.pdf'))return new Response(sample);
  if(u.pathname.endsWith('/full.pdf')){downloads++;return failed?new Response('temporary',{status:503}):new Response(full);}
  throw Error('Unexpected URL '+u.pathname);
 };
 try{await fn(generated,()=>downloads);}finally{global.fetch=oldFetch;for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('publication keeps a valid sample and measures full PDF pages',async()=>run(await document(4),async generated=>{assert.deepEqual(await validatePublication({...book,page_count:999}),{page_count:9,preview_path:'sample.pdf'});assert.equal(generated.length,0);}));
test('a missing optional sample is created privately without another author upload',async()=>run(null,async generated=>{const v=await validatePublication({...book,preview_path:null});assert.equal(v.page_count,9);assert.ok(v.preview_path.startsWith(id+'/sample-'));assert.equal(generated.length,1);assert.equal((await PDFDocument.load(generated[0].bytes)).getPageCount(),2);assert.ok(generated[0].path.startsWith('/storage/v1/object/ebook-previews/'));}));
test('a full paid book accidentally uploaded as its sample is replaced by a short safe sample',async()=>run(await document(7),async generated=>{const v=await validatePublication(book);assert.notEqual(v.preview_path,'sample.pdf');assert.equal((await PDFDocument.load(generated[0].bytes)).getPageCount(),2);},{full:await document(7)}));
test('invalid optional samples are repaired from the valid full PDF',async()=>run(new TextEncoder().encode('not a PDF'),async generated=>{await validatePublication(book);assert.equal(generated.length,1);}));
test('one-page products can publish without exposing their entire paid document as a sample',async()=>run(await document(1),async generated=>{assert.deepEqual(await validatePublication(book),{page_count:1,preview_path:null});assert.equal(generated.length,0);},{full:await document(1)}));
test('temporary storage failures are retried and never reported as an invalid PDF',async()=>run(await document(2),async(generated,downloads)=>{await assert.rejects(()=>validatePublication(book),e=>e.status===503&&!e.message.includes('halifunguki'));assert.equal(downloads(),2);assert.equal(generated.length,0);},{failed:true}));
test('a genuinely malformed full PDF is rejected before publication',async()=>run(await document(2),async generated=>{await assert.rejects(()=>validatePublication(book),e=>e.status===400&&e.message.includes('PDF kamili'));assert.equal(generated.length,0);},{full:new TextEncoder().encode('not a PDF')}));
test('scanner PDFs with a leading byte marker are accepted',async()=>{const pdf=await document(9),prefixed=new Uint8Array(pdf.length+3);prefixed.set([239,187,191]);prefixed.set(pdf,3);await run(await document(2),async()=>assert.equal((await validatePublication(book)).page_count,9),{full:prefixed});});
