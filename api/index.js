// Real Vercel API adapter: reuse the same checkout, payments, Admin and PDF API
// implemented for Netlify without importing preview-only UI modules.
// Vercel's Web Request preserves the exact raw body needed for Snippe HMAC validation.
import { handler } from '../netlify/functions/api.mjs';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const event = {
      httpMethod: request.method,
      headers: Object.fromEntries(request.headers),
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.text(),
      isBase64Encoded: false
    };
    const response = await handler(event);
    const status=response.statusCode??200;
    const bodiless=request.method==='HEAD'||[204,205,304].includes(status);
    return new Response(bodiless?null:response.body??null, {
      status,
      headers: response.headers ?? {}
    });
  }
};
