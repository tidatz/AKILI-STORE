import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import app from '../api/index.js';
const request=action=>app.fetch(new Request('https://store.test/api?action='+action));
async function fixture(run,{books=[{slug:'kitabu-cha-maarifa',title:'Maarifa',author_name:'QA',price_tzs:500,language:'Kiswahili',page_count:9,cover_path:'cover.webp',description:'Maelezo ya kitabu.',updated_at:'2026-11-14T10:30:00Z'}]}={}){
 const original=global.fetch,env={SITE_URL:'https://store.test',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-test'},prev=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),calls=[];Object.assign(process.env,env);
 global.fetch=async(input,opts={})=>{const url=new URL(input);calls.push({url,opts});return Response.json(books);};
 try{await run(calls);}finally{global.fetch=original;for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('sitemap includes only published named book URLs and omits accounts, receipts and protected files',async()=>fixture(async calls=>{
 const r=await request('sitemap');assert.equal(r.status,200);assert.ok(r.headers.get('Content-Type').startsWith('application/xml'));const xml=await r.text();
 assert.ok(xml.includes('<loc>https://store.test/book/kitabu-cha-maarifa</loc>'));assert.ok(xml.includes('<lastmod>2026-11-14T10:30:00.000Z</lastmod>'));
 for(const value of ['/admin','/checkout','/purchase','/reader','token=','pdf_path'])assert.equal(xml.includes(value),false);
 assert.equal(calls[0].url.searchParams.get('status'),'eq.published');
}));
test('sitemap refuses malformed slugs and never fabricates last-modification dates',async()=>fixture(async()=>{
 const xml=await (await request('sitemap')).text();assert.equal(xml.includes('../'),false);assert.equal(xml.includes('<script'),false);assert.equal(xml.includes('<lastmod>'),false);
 assert.ok(xml.includes('/book/real-book'));
},{books:[{slug:'../private?token=secret',updated_at:'bad'},{slug:'<script>',updated_at:'bad'},{slug:'real-book',updated_at:null}]}));
test('public storefront metadata is rendered on the server and has one canonical URL per page',async()=>fixture(async()=>{
 for(const [page,path,title]of [['home','/','AKILI STORE — Maarifa yanaanza hapa'],['books','/books','Vitabu vya Kidijitali | AKILI STORE'],['categories','/categories','Vitabu kwa Makundi | AKILI STORE']]){
  const r=await request('store-page&page='+page);assert.equal(r.status,200);const html=await r.text();
  assert.ok(html.includes('<title>'+title+'</title>'));assert.ok(html.includes('rel="canonical" href="https://store.test'+path+'"'));
  assert.equal((html.match(/rel="canonical"/g)||[]).length,1);assert.ok(html.includes('property="og:image"'));assert.ok(html.includes('application/ld+json'));
  assert.equal(html.includes('server-test'),false);
 }
 assert.equal((await request('store-page&page=admin')).status,404);
}));
test('book structured data contains the real price, currency, author and page count without invented reviews',async()=>fixture(async()=>{
 const r=await request('book-page&slug=kitabu-cha-maarifa'),html=await r.text();assert.equal(r.status,200);
 const data=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(data['@type'],'Book');assert.equal(data.offers.price,500);assert.equal(data.offers.priceCurrency,'TZS');assert.equal(data.author.name,'QA');assert.equal(data.numberOfPages,9);assert.equal(data.inLanguage,'sw');assert.equal(data.aggregateRating,undefined);
}));
test('structured metadata cannot break out of the script tag or HTML attributes',async()=>fixture(async()=>{
 const html=await (await request('book-page&slug=book')).text();const raw=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
 assert.equal(raw.includes('</script>'),false);assert.equal(html.includes('<script>alert(1)</script>'),false);assert.equal(JSON.parse(raw).name,'</script><script>alert(1)</script>');
},{books:[{slug:'book',title:'</script><script>alert(1)</script>',description:'" onload="alert(1)',author_name:'QA',price_tzs:500}]}));
test('robots and deployment headers keep account and payment pages out of search indexes',async()=>{
 const robots=await readFile(new URL('../public/robots.txt',import.meta.url),'utf8'),vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(robots.includes('Sitemap: https://www.akilistore.com/sitemap.xml'));
 for(const path of ['/admin','/checkout/:path*','/purchase/:path*','/reader.html','/profile-settings','/join-author']){
   const headers=vercel.headers.find(x=>x.source===path)?.headers;assert.ok(headers?.some(x=>x.key==='X-Robots-Tag'&&x.value.includes('noindex')),path);
 }
});
test('temporary database outages serve a branded retry page without caching an empty catalog',async()=>fixture(async()=>{
 global.fetch=async()=>Response.json({message:'temporary database outage'},{status:503});
 for(const action of ['store-page','book-page&slug=kitabu-cha-maarifa']){
   const r=await request(action);assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Retry-After'),'60');
   const html=await r.text();assert.ok(html.includes('id="app"'));assert.ok(html.includes('AKILI STORE'));assert.equal(html.includes('temporary database outage'),false);
 }
}));
