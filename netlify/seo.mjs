import {readFile} from 'node:fs/promises';
import {rows,one,eq,assetUrl,HttpError} from './lib.mjs';

export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validSlug=s=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s||'')&&s.length<=100;
export const siteOrigin=()=>new URL(process.env.SITE_URL||'https://www.akilistore.com').origin;
let shell;
export async function siteTemplate(){
 if(!shell)shell=readFile(new URL('../public/index.html',import.meta.url),'utf8').catch(()=>readFile(process.cwd()+'/public/index.html','utf8')).catch(e=>{shell=null;throw e;});
 return shell;
}
export const unavailablePage=html=>({statusCode:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'60'},body:html.replace('</head>','<meta name="robots" content="noindex"></head>')});
export function decorate(html,{title,description,url,image,type='website',schema}){
 const h=escapeHtml;
 const meta=`<link rel="canonical" href="${h(url)}"><meta property="og:type" content="${h(type)}"><meta property="og:site_name" content="AKILI STORE"><meta property="og:locale" content="sw_TZ"><meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(description)}"><meta property="og:url" content="${h(url)}">${image?`<meta property="og:image" content="${h(image)}"><meta property="og:image:alt" content="${h(title)}">`:''}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${h(title)}"><meta name="twitter:description" content="${h(description)}">${image?`<meta name="twitter:image" content="${h(image)}">`:''}`;
 const structured=schema?'<script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')+'</script>':'';
 return html.replace(/<title>[\s\S]*?<\/title>/i,'<title>'+h(title)+'</title>').replace(/<meta name="description" content="[^"]*">/i,'<meta name="description" content="'+h(description)+'">').replace('</head>',meta+structured+'</head>');
}
function withServerContent(html,content){
 // Replace the complete loading shell up to the next stable sibling; this keeps
 // the same #app mount point so the client application can take over normally.
 return html.replace(/<div id="app">[\s\S]*?(?=<div id="toast")/, '<div id="app">'+content+'</div>');
}
const money=value=>'TSh '+Number(value||0).toLocaleString('en-US');
function serverBookCard(book){
 const h=escapeHtml,image=assetUrl(book.cover_path);
 return `<article class="book-card"><a href="/book/${encodeURIComponent(book.slug)}"><div class="cover-box">${image?`<img src="${h(image)}" alt="Jalada: ${h(book.title)}" loading="lazy" decoding="async">`:'<span class="cover-empty">Jalada halijawekwa</span>'}<span class="format-tag">eBOOK · PDF</span></div><p class="category">${h(book.category)}</p><h2>${h(book.title)}</h2></a><p class="author">${h(book.author_name)}</p><div class="book-bottom"><span>${money(book.price_tzs)}</span><a class="btn secondary small" href="/book/${encodeURIComponent(book.slug)}">Tazama kitabu</a></div></article>`;
}
function storefrontContent(page,books){
 const cards=books.map(serverBookCard).join('')||'<p>Hakuna vitabu vilivyochapishwa kwa sasa.</p>';
 const heading=page==='categories'?'Vitabu kwa makundi':'Vitabu vya kidijitali';
 const intro=page==='home'?'Tafuta, nunua na soma vitabu vya maarifa kwenye AKILI STORE.':page==='categories'?'Gundua vitabu kulingana na mada na kundi.':'Chagua kitabu, soma maelezo yake na uanze kujifunza.';
 return `<main id="main" tabindex="-1"><div class="container storefront"><section class="storefront-find"><h1>Maarifa yanaanza hapa.</h1><p>${escapeHtml(intro)}</p><p><a class="text-link" href="/books">Angalia vitabu vyote</a></p></section><section class="section" aria-labelledby="catalog-heading"><div class="section-head"><div><p class="eyebrow">MAKTABA YA MAARIFA</p><h2 id="catalog-heading">${heading}</h2></div></div><div class="books-grid">${cards}</div></section></div></main>`;
}
export function bookSchema(book){
 const url=siteOrigin()+'/book/'+encodeURIComponent(book.slug),image=assetUrl(book.cover_path);
 return {'@context':'https://schema.org','@type':'Book',name:book.title,url,...(image?{image}:{}),author:{'@type':'Person',name:book.author_name},description:book.description||book.subtitle||'',bookFormat:'https://schema.org/EBook',...(book.language?{inLanguage:book.language==='Kiswahili'?'sw':book.language}:{}),...(Number.isInteger(book.page_count)&&book.page_count>0?{numberOfPages:book.page_count}:{}),offers:{'@type':'Offer',url,priceCurrency:'TZS',price:book.price_tzs,availability:'https://schema.org/InStock'}};
}
export async function storefrontPage(page='home'){
 const pages={home:{path:'/',description:'Tafuta, nunua na soma vitabu kwenye AKILI STORE.'},books:{path:'/books',description:'Tafuta vitabu vya kidijitali, soma sampuli na chagua kitabu chako kwenye AKILI STORE.'},categories:{path:'/categories',description:'Chagua vitabu kwa mada na kundi kwenye AKILI STORE.'}};
 const entry=pages[page];if(!entry)throw new HttpError(404,'Ukurasa haujapatikana.');
 const html=await siteTemplate();let books=[];
 try{books=await rows('ebook_books','select=title,slug,description,subtitle,cover_path,price_tzs,author_name,category,page_count,language&status=eq.published&order=featured.desc,created_at.desc&limit=1000');}catch{return unavailablePage(html);}
 const url=siteOrigin()+entry.path,first=books[0],image=first?.cover_path?assetUrl(first.cover_path):siteOrigin()+'/assets/akili-store-logo.png';
 const schema={'@context':'https://schema.org','@type':'WebSite',name:'AKILI STORE',url:siteOrigin()+'/',inLanguage:'sw',publisher:{'@type':'Organization',name:'AKILI STORE',logo:siteOrigin()+'/assets/akili-store-icon-512.png'},...(books.length?{mainEntity:{'@type':'ItemList',itemListElement:books.slice(0,20).map((b,i)=>({'@type':'ListItem',position:i+1,url:siteOrigin()+'/book/'+encodeURIComponent(b.slug),name:b.title}))}}:{})};
 const title=page==='home'?'AKILI STORE — Maarifa yanaanza hapa':page==='books'?'Vitabu vya Kidijitali | AKILI STORE':'Vitabu kwa Makundi | AKILI STORE';
 return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=120'},body:decorate(withServerContent(html,storefrontContent(page,books)),{title,description:entry.description,url,image,schema})};
}
function bookContent(book){
 const h=escapeHtml,image=assetUrl(book.cover_path);
 return `<main id="main" tabindex="-1"><div class="container"><nav class="crumb" aria-label="Breadcrumb"><a href="/books">Vitabu</a><span aria-hidden="true">›</span><span>${h(book.category)}</span></nav><article class="detail"><div class="detail-cover">${image?`<img src="${h(image)}" alt="Jalada la ${h(book.title)}" loading="eager" fetchpriority="high">`:'<span class="cover-empty">Jalada halijawekwa</span>'}</div><div><span class="eyebrow">${h(book.category)} · eBOOK</span><h1>${h(book.title)}</h1>${book.subtitle?`<p class="muted">${h(book.subtitle)}</p>`:''}<p>Na <strong>${h(book.author_name)}</strong></p><p class="detail-price">${money(book.price_tzs)}</p><p class="description">${h(book.description||'Gundua maelezo ya kitabu hiki kwenye AKILI STORE.')}</p><p>Kitabu kinafunguka baada ya malipo kuthibitishwa.</p><p><a class="btn primary" href="/checkout/${encodeURIComponent(book.slug)}">Nunua kitabu</a></p></div></article></div></main>`;
}
export async function bookPage(slug){
 const html=await siteTemplate();
 const valid=validSlug(slug);
 let book;try{book=valid?await one('ebook_books',eq('slug',slug)+'&status=eq.published','title,slug,description,subtitle,cover_path,price_tzs,author_name,category,page_count,language'):null;}catch{return unavailablePage(html);}
 if(!book)return {statusCode:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'},body:html.replace('</head>','<meta name="robots" content="noindex"></head>')};
 const origin=siteOrigin(),url=origin+'/book/'+encodeURIComponent(book.slug),image=assetUrl(book.cover_path);
 const title=book.title+' | AKILI STORE',description=(book.description||book.subtitle||'Nunua na soma kitabu kwenye AKILI STORE.').replace(/\s+/g,' ').slice(0,180);
 return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=120'},body:decorate(withServerContent(html,bookContent(book)),{title,description,url,image,type:'book',schema:bookSchema(book)})};
}
export async function sitemap(){
 const origin=siteOrigin(),books=await rows('ebook_books','select=slug,updated_at&status=eq.published&order=created_at.asc&limit=1000');
 const urls=['/','/books','/categories','/help','/platform-policies'].map(path=>({url:origin+path}));
 for(const b of books)if(validSlug(b.slug))urls.push({url:origin+'/book/'+encodeURIComponent(b.slug),updated:!Number.isNaN(Date.parse(b.updated_at))?new Date(b.updated_at).toISOString():null});
 const body='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(x=>'<url><loc>'+escapeHtml(x.url)+'</loc>'+(x.updated?'<lastmod>'+x.updated+'</lastmod>':'')+'</url>').join('')+'</urlset>';
 return {statusCode:200,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=300'},body};
}
