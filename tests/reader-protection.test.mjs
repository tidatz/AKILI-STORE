import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {watermarkPdf} from '../netlify/reader-protection.mjs';

test('every page receives a reader-specific watermark without changing page count', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([595, 842]);
  const original = await source.save();
  const first = await watermarkPdf(original, {
    email: 'reader@example.com',
    orderId: '11111111-1111-4111-8111-111111111111',
    bookId: '33333333-3333-4333-8333-333333333333',
    title: 'Kitabu cha Jaribio'
  });
  const second = await watermarkPdf(original, {
    email: 'another@example.com',
    orderId: '22222222-2222-4222-8222-222222222222',
    bookId: '33333333-3333-4333-8333-333333333333',
    title: 'Kitabu cha Jaribio'
  });
  const protectedPdf = await PDFDocument.load(first.bytes);
  assert.equal(protectedPdf.getPageCount(), 2);
  assert.match(protectedPdf.getTitle(), /Protected Reader Copy/);
  assert.match(protectedPdf.getSubject(), new RegExp(first.reference));
  assert.match(first.reference, /^AKS-[A-F0-9]{12}$/);
  assert.notEqual(first.reference, second.reference);
  assert.notDeepEqual(Buffer.from(first.bytes), Buffer.from(original));
  assert.notDeepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes));
});

test('watermarking rejects invalid or empty PDFs', async () => {
  await assert.rejects(() => watermarkPdf(new TextEncoder().encode('not a PDF'), {
    email: 'reader@example.com',
    orderId: '11111111-1111-4111-8111-111111111111'
  }), error => error.status === 422);
});
