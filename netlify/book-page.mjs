import {one,eq,assetUrl} from './lib.mjs';
import {siteTemplate,siteOrigin,decorate,bookSchema,unavailablePage} from './seo.mjs';
export async function bookPage(slug){
 const html=await siteTemplate();
 const valid=/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug||'')&&(slug||'').length<=100;
 let book;try{book=valid?await one('ebook_books',eq('slug',slug)+'&status=eq.published','title,slug,description,subtitle,cover_path,price_tzs,author_name,page_count,language'):null;}catch{return unavailablePage(html);}
 if(!book)return {statusCode:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'},body:html.replace('</head>','<meta name="robots" content="noindex"></head>')};
 const origin=siteOrigin();
 const url=origin+'/book/'+encodeURIComponent(book.slug),image=assetUrl(book.cover_path);
 const title=book.title+' | AKILI STORE',description=(book.description||book.subtitle||'Nunua na soma kitabu kwenye AKILI STORE.').replace(/\s+/g,' ').slice(0,180);
 return {statusCode:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=120'},body:decorate(html,{title,description,url,image,type:'book',schema:bookSchema(book)})};
}
