import crypto from 'node:crypto';
import {PDFDocument, StandardFonts, rgb, degrees} from 'pdf-lib';
import {HttpError, sha, signFile} from './lib.mjs';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const encodedPath = path => path.split('/').map(encodeURIComponent).join('/');
const maskedEmail = value => {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return 'verified reader';
  return email[0] + '***@' + email.slice(at + 1);
};

export async function watermarkPdf(sourceBytes, {email, orderId, userId, bookId, title} = {}) {
  let pdf;
  try {
    pdf = await PDFDocument.load(sourceBytes, {updateMetadata: false, throwOnInvalidObject: false});
    if (!pdf.getPageCount()) throw new Error('empty PDF');
  } catch {
    throw new HttpError(422, 'PDF ya kitabu haiwezi kufunguliwa kwa usomaji salama.');
  }

  const identity = String(orderId || (String(userId || '') + ':' + String(bookId || '')));
  const reference = 'AKS-' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12).toUpperCase();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const footer = 'AKILI STORE | Licensed to ' + maskedEmail(email) + ' | REF ' + reference;
  const diagonal = 'AKILI STORE - ' + reference;

  for (const page of pdf.getPages()) {
    const {width, height} = page.getSize();
    const size = Math.max(12, Math.min(23, width * 0.035));
    const diagonalWidth = font.widthOfTextAtSize(diagonal, size);
    page.drawText(diagonal, {
      x: Math.max(12, (width - diagonalWidth) / 2),
      y: height * 0.48,
      size,
      font: bold,
      color: rgb(0.28, 0.34, 0.46),
      opacity: 0.16,
      rotate: degrees(32)
    });
    page.drawText(footer, {
      x: 18,
      y: 12,
      size: 7,
      font,
      color: rgb(0.20, 0.25, 0.36),
      opacity: 0.72,
      maxWidth: Math.max(80, width - 36)
    });
  }

  pdf.setTitle(String(title || 'AKILI STORE') + ' | Protected Reader Copy');
  pdf.setSubject('Licensed copy ' + reference);
  pdf.setKeywords(['AKILI STORE', 'licensed reader copy', reference]);
  return {bytes: await pdf.save({useObjectStreams: true}), reference};
}

export async function createProtectedReaderFile({book, order = null, user = null}) {
  if (!book?.pdf_path) throw new HttpError(404, 'PDF ya kitabu haipatikani.');
  const {SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY} = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, 'Huduma ya usomaji salama haijasanidiwa.');

  const ownerKey = order?.id || user?.id;
  if (!ownerKey || !/^[0-9a-f-]{36}$/i.test(String(ownerKey))) {
    throw new HttpError(403, 'Utambulisho wa msomaji haujathibitishwa.');
  }
  const cachePath = ownerKey + '/' + book.id + '.pdf';
  const sourceUrl = await signFile('ebook-pdfs', book.pdf_path, 120);
  let response;
  try {
    response = await fetch(sourceUrl, {signal: AbortSignal.timeout(30000)});
  } catch {
    throw new HttpError(503, 'PDF haijapatikana kwa sasa. Jaribu tena.');
  }
  if (!response.ok) throw new HttpError(503, 'PDF haijapatikana kwa sasa. Jaribu tena.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PDF_BYTES) throw new HttpError(413, 'PDF imezidi ukubwa unaoruhusiwa kwa usomaji salama.');
  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  if (!sourceBytes.length || sourceBytes.length > MAX_PDF_BYTES) {
    throw new HttpError(413, 'PDF imezidi ukubwa unaoruhusiwa kwa usomaji salama.');
  }

  const {bytes, reference} = await watermarkPdf(sourceBytes, {
    email: order?.customer_email || user?.email,
    orderId: order?.id,
    userId: user?.id,
    bookId: book.id,
    title: book.title
  });
  let uploaded;
  try {
    uploaded = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/ebook-reader-cache/' + encodedPath(cachePath), {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=1800',
        'x-upsert': 'true'
      },
      body: bytes,
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    throw new HttpError(503, 'Nakala salama haijahifadhiwa. Jaribu tena.');
  }
  if (!uploaded.ok) {
    console.error('Protected reader upload failed', uploaded.status);
    throw new HttpError(503, 'Nakala salama haijahifadhiwa. Jaribu tena.');
  }

  return {url: await signFile('ebook-reader-cache', cachePath, 1800), reference};
}
