import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';
import {attachAffiliateOrder} from '../netlify/affiliates.mjs';

const uid='11111111-1111-4111-8111-111111111111';
const affiliateId='22222222-2222-4222-8222-222222222222';
const bookId='33333333-3333-4333-8333-333333333333';
const orderId='44444444-4444-4444-8444-444444444444';
const originalFetch=global.fetch;
const request=(action,body,token='reader-token',query='')=>app.fetch(new Request('https://store.test/api?action='+action+query,{
 method:body?'POST':'GET',
 headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
}));

async function withMock(callback,overrides={},admin=false){
 const old={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
 Object.assign(process.env,{SUPABASE_URL:'https://database.test',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test'});
 const calls=[];
 global.fetch=async(url,opts={})=>{
  url=new URL(url);calls.push({path:url.pathname,query:url.search,opts});
  if(overrides[url.pathname]){const value=await overrides[url.pathname](url,opts);if(value instanceof Response)return value;return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});}
  let value=[];
  if(url.pathname==='/auth/v1/user')value={id:uid,email:'qa@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{}};
  else if(url.pathname==='/rest/v1/akili_profiles')value=[{user_id:uid,display_name:'QA Affiliate',email:'qa@example.invalid',role:'reader',status:'active'}];
  else if(url.pathname==='/rest/v1/ebook_admins')value=admin?[{user_id:uid}]:[];
  else if(url.pathname==='/rest/v1/ebook_books')value=[{id:bookId,title:'Book',status:'published'}];
  else if(url.pathname==='/rest/v1/akili_affiliates')value=[{id:affiliateId,user_id:uid,code:'qa-123',status:'active'}];
  else if(url.pathname==='/rest/v1/akili_affiliate_campaigns')value=[];
  else if(url.pathname==='/rest/v1/akili_affiliate_product_rules')value=[];
  else if(url.pathname==='/rest/v1/akili_affiliate_clicks'&&opts.method==='POST')value=[JSON.parse(opts.body)];
  else if(url.pathname==='/rest/v1/akili_order_attributions'&&opts.method==='POST')value=[JSON.parse(opts.body)];
  else if(url.pathname==='/rest/v1/akili_profiles'&&opts.method==='PATCH')value=[];
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{await callback(calls);}finally{
  global.fetch=originalFetch;
  for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}

test('public affiliate link creates a hashed click token without exposing its stored hash',async()=>withMock(async calls=>{
 const r=await request('affiliate-visit',null,null,'&ref=qa-123&product='+bookId);
 assert.equal(r.status,200);
 const data=await r.json();assert.ok(data.token);assert.equal(data.expires_in_days,30);
 const click=calls.find(c=>c.path==='/rest/v1/akili_affiliate_clicks'&&c.opts.method==='POST');
 assert.ok(click);assert.notEqual(JSON.parse(click.opts.body).token_hash,data.token);
 assert.equal(JSON.parse(click.opts.body).commission_percent_of_platform,0);
}));

test('admin can configure a product commission as a percentage of platform share',async()=>withMock(async()=>{
 const r=await request('market-admin-affiliate-product-rule',{product_id:bookId,commission_percent_of_platform:25,active:true},'admin-token');
 assert.equal(r.status,200);const result=await r.json();assert.equal(result.saved,true);
}, {}, true));

test('admin commission percentage above 100 is rejected',async()=>withMock(async()=>{
 const r=await request('market-admin-affiliate-product-rule',{product_id:bookId,commission_percent_of_platform:101},'admin-token');
 assert.equal(r.status,400);
}, {}, true));

test('campaign attribution rate is snapshotted and self-referral is rejected',async()=>withMock(async()=>{
 const token='a'.repeat(64);
 await assert.rejects(()=>attachAffiliateOrder({id:orderId,user_id:uid,customer_email:'qa@example.invalid'},token,bookId),/Self-referral hairuhusiwi/);
},{
 '/rest/v1/akili_affiliate_clicks':()=>[{id:'55555555-5555-4555-8555-555555555555',affiliate_id:affiliateId,campaign_id:null,product_id:bookId,token_hash:'a'.repeat(64),commission_percent_of_platform:30,expires_at:'2099-01-01T00:00:00Z'}],
 '/rest/v1/akili_profiles':()=>[{user_id:uid,email:'qa@example.invalid'}]
}));
