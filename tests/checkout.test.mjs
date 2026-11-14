import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../api/index.js';

const uid='11111111-1111-4111-8111-111111111111',bookId='22222222-2222-4222-8222-222222222222',orderId='33333333-3333-4333-8333-333333333333',checkoutId='44444444-4444-4444-8444-444444444444';
const body={bookId,checkoutId,name:'Store Owner',phone:'0712345678',clientSecret:'a'.repeat(64),verification:true};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function fixture(run,{admin=true,enabled=false,owned=false,verified=true}={}){
 const env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'server-test',SUPABASE_PUBLISHABLE_KEY:'public-test',SNIPPE_API_KEY:'snippe-test',SNIPPE_WEBHOOK_SECRET:'webhook-test',SNIPPE_PAYMENTS_ENABLED:String(enabled),SITE_URL:'https://store.test'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),original=global.fetch;
 Object.assign(process.env,env);const state={order:null,payment:null,providerCalls:[],reads:0};
 global.fetch=async(input,opts={})=>{
  const url=new URL(input),path=url.pathname,b=opts.body?JSON.parse(opts.body):null;state.reads++;
  if(url.hostname==='api.snippe.sh'){
   assert.equal(path,'/v1/payments');assert.equal(opts.method,'POST');state.providerCalls.push({body:b,headers:opts.headers});
   return response({status:'success',data:{reference:'provider-test-reference',status:'pending'}});
  }
  if(path==='/auth/v1/user')return response({id:uid,email:'owner@example.invalid',email_confirmed_at:verified?'2026-01-01':null,user_metadata:{role:'admin'}});
  if(path==='/rest/v1/ebook_admins')return response(admin?[{user_id:uid}]:[]);
  if(path==='/rest/v1/akili_profiles')return response([{user_id:uid,email:'owner@example.invalid',role:'reader',status:'active'}]);
  if(path==='/rest/v1/akili_entitlements')return response(owned?[{user_id:uid,book_id:bookId}]:[]);
  if(path==='/rest/v1/ebook_books')return response([{id:bookId,title:'Real book',price_tzs:25000,status:'published',pdf_path:'private.pdf'}]);
  if(path==='/rest/v1/ebook_orders'){
   if(opts.method==='POST'){state.order={id:orderId,status:'pending',...b};return response([state.order]);}
   if(url.searchParams.has('customer_phone'))return response([]);
   return response(state.order?[state.order]:[]);
  }
  if(path==='/rest/v1/ebook_payments'){
   if(opts.method==='POST'){state.payment=b;return response([b]);}
   return response(state.payment?[state.payment]:[]);
  }
  throw Error('Unexpected request '+path);
 };
 const checkout=(values=body,token='session',origin='https://store.test')=>app.fetch(new Request('https://store.test/api?action=checkout',{method:'POST',headers:{host:'store.test',origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(values)}));
 try{await run(state,checkout);}finally{global.fetch=original;for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('admin launch check fixes the real charge at TSh 500 and binds the canonical callback',async()=>fixture(async(state,checkout)=>{
 const result=await checkout({...body,amount_tzs:1,price_tzs:1,email:'other@example.invalid'});
 assert.equal(result.status,201);assert.equal((await result.json()).amount_tzs,500);assert.equal(state.order.verification_test,true);
 assert.equal(state.order.customer_email,'owner@example.invalid');assert.equal(state.providerCalls.length,1);
 const call=state.providerCalls[0];assert.equal(call.body.details.amount,500);assert.equal(call.body.phone_number,'255712345678');
 assert.equal(call.body.webhook_url,'https://store.test/api?action=webhook');assert.equal(call.body.metadata.order_id,orderId);
 assert.equal(call.body.metadata.verification_test,true);assert.ok(call.headers['Idempotency-Key'].length<=30);
 assert.equal(state.payment.amount_tzs,500);assert.equal(state.order.status,'pending');
}));
test('retrying a launch check returns the same order without another provider request',async()=>fixture(async(state,checkout)=>{
 assert.equal((await checkout()).status,201);assert.equal((await checkout()).status,200);assert.equal(state.providerCalls.length,1);
}));
test('a reader cannot claim the admin price using editable metadata or a verification flag',async()=>fixture(async(state,checkout)=>{
 assert.equal((await checkout()).status,403);assert.equal(state.order,null);assert.equal(state.providerCalls.length,0);
},{admin:false}));
test('anonymous and unconfirmed users cannot start an admin verification charge',async()=>{
 await fixture(async(state,checkout)=>{assert.equal((await checkout(body,null)).status,401);assert.equal(state.reads,0);});
 await fixture(async(state,checkout)=>{assert.equal((await checkout()).status,403);assert.equal(state.providerCalls.length,0);},{verified:false});
});
test('ordinary checkout stays closed before activation and cannot use a string to claim verification',async()=>fixture(async(state,checkout)=>{
 for(const verification of [false,'true',null])assert.equal((await checkout({...body,verification})).status,503);
 assert.equal(state.reads,0);assert.equal(state.providerCalls.length,0);
}));
test('ordinary reader checkout uses the database price regardless of client supplied amounts',async()=>fixture(async(state,checkout)=>{
 const result=await checkout({...body,verification:false,amount_tzs:500,price_tzs:500});assert.equal(result.status,201);
 assert.equal(state.order.amount_tzs,25000);assert.equal(state.order.verification_test,false);assert.equal(state.providerCalls[0].body.details.amount,25000);
},{admin:false,enabled:true}));
test('launch discounts close after public activation and owned books cannot be charged again',async()=>{
 await fixture(async(state,checkout)=>{assert.equal((await checkout()).status,409);assert.equal(state.providerCalls.length,0);},{enabled:true});
 await fixture(async(state,checkout)=>{assert.equal((await checkout()).status,409);assert.equal(state.providerCalls.length,0);},{owned:true});
});
test('changing a saved normal checkout into a discounted check cannot reuse the order',async()=>fixture(async(state,checkout)=>{
 state.order={id:orderId,checkout_id:checkoutId,book_id:bookId,user_id:uid,customer_email:'owner@example.invalid',customer_phone:'255712345678',checkout_secret_hash:'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',verification_test:false,amount_tzs:25000};
 assert.equal((await checkout()).status,409);assert.equal(state.providerCalls.length,0);assert.equal(state.order.amount_tzs,25000);
}));
test('cross origin requests and invalid mobile numbers fail before payment creation',async()=>fixture(async(state,checkout)=>{
 assert.equal((await checkout(body,'session','https://other.test')).status,403);
 assert.equal((await checkout({...body,phone:'0221234567'})).status,400);assert.equal(state.providerCalls.length,0);
}));
