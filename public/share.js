export function publicBookLink(slug){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug||''))throw Error('Kiungo cha kitabu hakijapatikana.');
 return location.origin+'/book/'+encodeURIComponent(slug);
}
export async function shareBook(book){
 const url=publicBookLink(book.slug),data={title:book.title,text:book.title+' — AKILI STORE',url};
 if(navigator.share){try{await navigator.share(data);return {shared:true,url};}catch(e){if(e.name==='AbortError')return {cancelled:true,url};}}
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url);return {copied:true,url};}catch{}}
 return {url};
}
