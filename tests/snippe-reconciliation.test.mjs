import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../netlify/functions/api.mjs';

const orderId='11111111-1111-4111-8111-111111111111';
const paymentId='22222222-2222-4222-8222-222222222222';
const userId='33333333-3333-4333-8333-333333333333';
const secret='a'.repeat(64);
const originalFetch=globalThis.fetch;
const required={SUPABASE_URL:'https://mock.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'unit-test-only',SUPABASE_PUBLISHABLE_KEY:'public-unit-test',
  SNIPPE_API_KEY:'unit-test-only',SNIPPE_WEBHOOK_SECRET:'unit-test-only',
  SITE_URL:'https://test-ebook.vercel.app'};

function fixture(amount=25000,{owner=true,verified=true,active=true}={}) {
  const calls={provider:0,applied:0,others:0};
  let order={id:orderId,user_id:userId,status:'pending',amount_tzs:25000,checkout_secret_hash:
    'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'};
  let payment={id:paymentId,order_id:orderId,provider_reference:'ref_mock',
    status:'pending',amount_tzs:25000,currency:'TZS',last_checked_at:null};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  // Order hash below is set to SHA-256('a' * 64) without use of real credentials.
  const mock=async (url,opts={})=>{
    const path=new URL(url).pathname;
    if(path==='/auth/v1/user')return reply({id:owner?userId:'44444444-4444-4444-8444-444444444444',email:'reader@example.invalid',email_confirmed_at:verified?'2026-01-01':null});
    if(path==='/rest/v1/akili_profiles')return reply([{email:'reader@example.invalid',role:'reader',status:active?'active':'restricted'}]);
    if(path==='/rest/v1/ebook_admins')return reply([]);
    if(new URL(url).hostname==='api.snippe.sh'){
      calls.provider++;
      return reply({status:'success',data:{reference:'ref_mock',status:'completed',
        amount:{value:amount,currency:'TZS'},metadata:{order_id:orderId}}});
    }
    if(path.includes('/rest/v1/ebook_orders')) {
      if(new URL(url).searchParams.get('select')==='status')return reply([{status:order.status}]);
      return reply([order]);
    }
    if(path.includes('/rest/v1/ebook_payments')) {
      if(opts.method==='PATCH') {
        payment.last_checked_at=JSON.parse(opts.body).last_checked_at;
        return reply([payment]);
      }
      return reply([payment]);
    }
    if(path.includes('/rest/v1/rpc/ebook_apply_payment_event')) {
      calls.applied++;
      order.status='paid'; payment.status='completed';
      return reply(true);
    }
    calls.others++;throw Error('Unknown endpoint '+path);
  };
  return {calls,mock,order,payment};
}
async function statusRequest(clientSecret=secret,token=''){
  const body=JSON.stringify({orderId,clientSecret});
  return handler({httpMethod:'POST',headers:{host:'test-ebook.vercel.app',...(token?{Authorization:'Bearer '+token}:{})},
    queryStringParameters:{action:'status'},body,isBase64Encoded:false});
}
async function withFixture(f,fn){
  const previous=Object.fromEntries(Object.keys(required).map(k=>[k,process.env[k]]));
  try{
    Object.assign(process.env,required);globalThis.fetch=f.mock;
    await fn(f);
  }finally{
    globalThis.fetch=originalFetch;
    for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
}

test('a paid status requires verified Snippe amount and can be polled without duplicate processing',async()=>{
  const f=fixture(25000);
  await withFixture(f,async()=>{
    const first=await statusRequest();
    assert.equal(first.statusCode,200);
    assert.equal(JSON.parse(first.body).status,'paid');
    const second=await statusRequest();
    assert.equal(JSON.parse(second.body).status,'paid');
    assert.equal(f.calls.applied,1);
    assert.equal(f.calls.provider,1);
    assert.ok(f.payment.last_checked_at);
  });
});
test('an amount mismatch never marks an order paid',async()=>{
  const f=fixture(500);
  await withFixture(f,async()=>{
    const r=await statusRequest();
    assert.equal(JSON.parse(r.body).status,'pending');
    assert.equal(f.calls.applied,0);
  });
});
test('invalid checkout secret cannot trigger provider lookup',async()=>{
  const f=fixture();
  await withFixture(f,async()=>{
    const r=await statusRequest('b'.repeat(64));
    assert.equal(r.statusCode,403);
    assert.equal(f.calls.provider,0);
  });
});
test('a verified buyer can recover their own payment from order history without a checkout secret',async()=>{
  const f=fixture();
  await withFixture(f,async()=>{
    const r=await statusRequest(null,'reader-session');
    assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).status,'paid');
    assert.equal(f.calls.provider,1);assert.equal(f.calls.applied,1);
  });
});
test('another buyer cannot read or reconcile an order even when signed in',async()=>{
  const f=fixture(25000,{owner:false});
  await withFixture(f,async()=>{
    assert.equal((await statusRequest(null,'other-reader-session')).statusCode,403);
    assert.equal(f.calls.provider,0);assert.equal(f.calls.applied,0);
  });
});
test('unverified and restricted buyers cannot use order history reconciliation',async()=>{
  for(const options of [{verified:false},{active:false}]){
    const f=fixture(25000,options);
    await withFixture(f,async()=>{
      assert.equal((await statusRequest(null,'reader-session')).statusCode,403);
      assert.equal(f.calls.provider,0);assert.equal(f.calls.applied,0);
    });
  }
});
test('anonymous order history requests remain forbidden',async()=>{
  const f=fixture();
  await withFixture(f,async()=>{
    assert.equal((await statusRequest(null)).statusCode,403);assert.equal(f.calls.provider,0);
  });
});
