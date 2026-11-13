import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyWebhook, sha, randomToken, isUuid, HttpError} from '../netlify/lib.mjs';

test('one-way hashes and generated access tokens are unpredictable',()=>{
  const a=randomToken(),b=randomToken();
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,b);
  assert.notEqual(sha(a),a);
  assert.equal(sha(a),sha(a));
});
test('UUID validation refuses malformed identifiers',()=>{
  assert.equal(isUuid('12345678-1234-1234-1234-123456789abc'),true);
  assert.equal(isUuid('x'),false);
});
test('webhook requires authentic signed raw body',()=>{
  process.env.SNIPPE_WEBHOOK_SECRET='temporary-test-key';
  const timestamp=String(Math.floor(Date.now()/1000));
  const body='{"id":"evt_1","type":"payment.completed","data":{"reference":"abc"}}';
  const signature=crypto.createHmac('sha256',process.env.SNIPPE_WEBHOOK_SECRET)
    .update(timestamp+'.'+body).digest('hex');
  const event={body,headers:{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature}};
  assert.equal(verifyWebhook(event).id,'evt_1');
  assert.throws(()=>verifyWebhook({...event,body:body+' '}),HttpError);
  assert.throws(()=>verifyWebhook({...event,headers:{...event.headers,'x-webhook-timestamp':String(Number(timestamp)-500)}}),HttpError);
  delete process.env.SNIPPE_WEBHOOK_SECRET;
});
