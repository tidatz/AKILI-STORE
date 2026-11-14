import {readFile} from 'node:fs/promises';
import {one,eq,assetUrl} from './lib.mjs';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let shell;
async function template(){
 if(!shell)shell=readFile(new URL('../public/index.html',import.meta.url),'utf8').catch(()=>readFile(process.cwd()+'/public/index.html','utf8')).catch(e=>{shell=null;throw e;});
 return shell;
}
export async function bookPage(slug){
 const html=await template();
 const valid=/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug||'')&&(slug||'').length<=100;
 const book=valid?await one('ebook_books',eq('slug',slug)+'&status=eq.published','title,slug,description,subtitle,cover_path,price_tzs,author_name'):null;
 if(!book)return {statusCode:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'},body:html.replace('</head>','<meta name="robots" content="noindex"></head>')};
 const origin=new URL(process.env.SITE_URL||'https://www.akilistore.com').origin;
 const url=origin+'/book/'+encodeURIComponent(book.slug),image=assetUrl(book.cover_path);
 const title=book.title+' | AKILI STORE',description=(book.description||book.subtitle||'Nunua na soma kitabu kwenye AKILI STORE.').replace(/\s+/g,' ').slice(0,180);
 const meta=`<link rel="canonical" href="${escape(url)}"><meta property="og:type" content="book"><meta property="og:site_name" content="AKILI STORE"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}">${image?`<meta property="og:image" content="${escape(image)}"><meta property="og:image:alt" content="${escape(book.title)}">`:''}<meta name="twitter:card" content="summary_large_image">`;
 return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=120'},body:html.replace('<title>AKILI STORE</title>','<title>'+escape(title)+'</title>').replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="'+escape(description)+'">').replace('</head>',meta+'</head>')};
}
