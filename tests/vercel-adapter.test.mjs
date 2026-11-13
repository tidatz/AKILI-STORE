import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';

test('GET /api?action=config uses the real API without requiring payment secrets',async()=>{
 const reply=await app.fetch(new Request('https://example.vercel.app/api?action=config'));
 assert.equal(reply.status,200);
 const json=await reply.json();
 assert.equal(typeof json,'object');
 assert.equal(typeof json.supabase_url,'string');
 assert.equal(typeof json.publishable_key,'string');
});

test('GET /api?action=site fails safely if database secrets are missing',async()=>{
 const old=process.env.SUPABASE_URL;
 const oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 try{
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const reply=await app.fetch(new Request('https://example.vercel.app/api?action=site'));
  assert.equal(reply.status,503);
  const json=await reply.json();
  assert.match(json.error,/configuration/i);
 }finally{
  if(old!==undefined)process.env.SUPABASE_URL=old;
  if(oldKey!==undefined)process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});

test('Snippe checkout remains disabled with credentials until explicit activation',async()=>{
 const old=process.env.SNIPPE_PAYMENTS_ENABLED;
 const oldApi=process.env.SNIPPE_API_KEY;
 const oldSecret=process.env.SNIPPE_WEBHOOK_SECRET;
 const oldSite=process.env.SITE_URL;
 try{
  delete process.env.SNIPPE_PAYMENTS_ENABLED;
  process.env.SNIPPE_API_KEY='fake-credential-for-test';
  process.env.SNIPPE_WEBHOOK_SECRET='fake-webhook-secret';
  process.env.SITE_URL='https://example.vercel.app';
  const response=await app.fetch(new Request('https://example.vercel.app/api?action=checkout',{
   method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
  }));
  assert.equal(response.status,503);
  const data=await response.json();
  assert.match(data.error,/Malipo hayajawashwa/);
 }finally{
  const values={SNIPPE_PAYMENTS_ENABLED:old,SNIPPE_API_KEY:oldApi,
   SNIPPE_WEBHOOK_SECRET:oldSecret,SITE_URL:oldSite};
  for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
