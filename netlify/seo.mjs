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
export function bookSchema(book){
 const url=siteOrigin()+'/book/'+encodeURIComponent(book.slug),image=assetUrl(book.cover_path);
 return {'@context':'https://schema.org','@type':'Book',name:book.title,url,...(image?{image}:{}),author:{'@type':'Person',name:book.author_name},description:book.description||book.subtitle||'',bookFormat:'https://schema.org/EBook',...(book.language?{inLanguage:book.language==='Kiswahili'?'sw':book.language}:{}),...(Number.isInteger(book.page_count)&&book.page_count>0?{numberOfPages:book.page_count}:{}),offers:{'@type':'Offer',url,priceCurrency:'TZS',price:book.price_tzs,availability:'https://schema.org/InStock'}};
}
export async function storefrontPage(page='home'){
 const pages={home:{path:'/',description:'Tafuta, nunua na soma vitabu kwenye AKILI STORE.'},books:{path:'/books',description:'Tafuta vitabu vya kidijitali, soma sampuli na chagua kitabu chako kwenye AKILI STORE.'},categories:{path:'/categories',description:'Chagua vitabu kwa mada na kundi kwenye AKILI STORE.'}};
 const entry=pages[page];if(!entry)throw new HttpError(404,'Ukurasa haujapatikana.');
 const html=await siteTemplate();let book;
 try{book=await one('ebook_books','status=eq.published&order=created_at.asc','title,slug,description,subtitle,cover_path,price_tzs,author_name,page_count,language');}catch{return unavailablePage(html);}
 const url=siteOrigin()+entry.path,image=book?.cover_path?assetUrl(book.cover_path):siteOrigin()+'/assets/akili-store-logo.png';
 const schema={'@context':'https://schema.org','@type':'WebSite',name:'AKILI STORE',url:siteOrigin()+'/',inLanguage:'sw',publisher:{'@type':'Organization',name:'AKILI STORE',logo:siteOrigin()+'/assets/akili-store-icon-512.png'}};
 return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=120'},body:decorate(html,{title:'AKILI STORE',description:entry.description,url,image,schema})};
}
export async function sitemap(){
 const origin=siteOrigin(),books=await rows('ebook_books','select=slug,updated_at&status=eq.published&order=created_at.asc&limit=1000');
 const urls=['/','/books','/categories','/help','/platform-policies'].map(path=>({url:origin+path}));
 for(const b of books)if(validSlug(b.slug))urls.push({url:origin+'/book/'+encodeURIComponent(b.slug),updated:!Number.isNaN(Date.parse(b.updated_at))?new Date(b.updated_at).toISOString():null});
 const body='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(x=>'<url><loc>'+escapeHtml(x.url)+'</loc>'+(x.updated?'<lastmod>'+x.updated+'</lastmod>':'')+'</url>').join('')+'</urlset>';
 return {statusCode:200,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=300'},body};
}
