import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/author_full_earnings.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../netlify/marketplace.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../public/market.js', import.meta.url), 'utf8');

test('verified book payments credit 100% of the paid amount to the author', () => {
  assert.match(migration, /values\s*\(o\.id,b\.author_id,'author',p_amount\)/i);
  assert.match(migration, /\(o\.id,null,'system',0\)/i);
  assert.match(migration, /\(o\.id,null,'platform',0\)/i);
  assert.match(migration, /set author_percent = 100/i);
});

test('authors have one fixed TSh 2,000 withdrawal fee and no higher minimum', () => {
  assert.match(migration, /minimum := 2001;\s*fee := 2000;/i);
  assert.match(api, /withdrawal_min_tzs:2001,withdrawal_fee_tzs:2000/);
  assert.match(ui, /Ada ni TSh 2,000 tu kwa ombi/);
  assert.match(ui, /min="2001"/);
});

test('author dashboard clearly labels 100% sale earnings', () => {
  assert.match(ui, /Mapato yangu \(100%\)/);
  assert.match(ui, /Unapata 100% ya bei ya kila kitabu/);
});
