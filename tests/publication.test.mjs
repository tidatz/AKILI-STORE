import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {validatePublication} from '../netlify/marketplace.mjs';
const id='11111111-1111-4111-8111-111111111111';
const book={title:'Publication test',author_id:id,author_name:'QA',category:'Biashara',price_tzs:25000,cover_path:'cover.png',pdf_path:'full.pdf',preview_path:'sample.pdf'};
async function document(pages){const p=await PDFDocument.create();for(let i=0;i<pages;i++)p.addPage();return p.save();}
async function run(sample,fn){const oldFetch=global.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;const full=await document(9);process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-server';global.fetch=async(url,opts={})=>{const u=new URL(url);if(u.pathname.includes('/rest/v1/akili_profiles'))return Response.json([{user_id:id,role:'author',status:'active'}]);if(opts.method==='POST'&&u.pathname.includes('/storage/'))return Response.json({signedURL:u.pathname.replace('/storage/v1','')});if(u.pathname.endsWith('/sample.pdf'))return new Response(sample);if(u.pathname.endsWith('/full.pdf'))return new Response(full);throw Error('Unexpected URL '+u.pathname);};try{await fn();}finally{global.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}}
test('publication accepts a separate four-page sample from a nine-page book',async()=>run(await document(4),async()=>assert.equal(await validatePublication(book),undefined)));
test('publication rejects a full paid PDF uploaded as a public sample',async()=>run(await document(9),async()=>assert.rejects(()=>validatePublication(book),e=>e.status===400&&/Sampuli/.test(e.message))));
test('publication rejects files that are not valid PDF documents',async()=>run(new TextEncoder().encode('not a PDF'),async()=>assert.rejects(()=>validatePublication(book),e=>e.status===400&&/PDF/.test(e.message))));
