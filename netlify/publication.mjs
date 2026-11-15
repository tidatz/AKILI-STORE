import crypto from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {HttpError,signFile} from './lib.mjs';

export const uploadKinds={
 cover:{bucket:'ebook-assets',field:'cover_path',max:10485760},
 pdf:{bucket:'ebook-pdfs',field:'pdf_path',max:52428800},
 preview:{bucket:'ebook-previews',field:'preview_path',max:10485760}
};
const unavailable=()=>new HttpError(503,'Huduma ya mafaili haijajibu kwa sasa. Faili lako halijakataliwa; jaribu tena.');

export async function storedBytes(bucket,path,max,label){
 let url;try{url=await signFile(bucket,path,120);}catch{throw unavailable();}
 for(let attempt=0;attempt<2;attempt++){
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(20000)});
   if(r.status===404)throw new HttpError(400,label+' halijapatikana. Pakia faili hilo tena.');
   if(!r.ok){if(attempt===0&&(r.status===429||r.status>=500))continue;throw unavailable();}
   if(Number(r.headers.get('content-length'))>max)throw new HttpError(400,label+' limezidi ukubwa unaoruhusiwa.');
   const bytes=new Uint8Array(await r.arrayBuffer());
   if(!bytes.length||bytes.length>max)throw new HttpError(400,label+' ni tupu au limezidi ukubwa unaoruhusiwa.');
   return bytes;
  }catch(e){if(e instanceof HttpError)throw e;if(attempt===1)throw unavailable();}
 }
}
export async function openPdf(bytes,label='PDF kamili'){
 try{
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:false});
  if(pdf.getPageCount()<1)throw Error('empty');
  return pdf;
 }catch(e){
  throw new HttpError(400,/encrypt|password/i.test(e.message)?label+' limefungwa kwa nenosiri. Pakia PDF linalofunguka bila nenosiri.':label+' halifunguki kama PDF. Jaribu kulihifadhi tena kama PDF kisha ulipakie.');
 }
}
async function automaticPreview(book,full){
 const total=full.getPageCount();if(total<2)return null;
 let pages=Math.min(4,Math.max(1,Math.ceil(total*.15)),total-1),bytes;
 do{
  const sample=await PDFDocument.create();
  const copied=await sample.copyPages(full,Array.from({length:pages},(_,i)=>i));
  copied.forEach(page=>sample.addPage(page));bytes=await sample.save();
  if(bytes.length<=uploadKinds.preview.max)break;
 }while(--pages>0);
 // A one-page product, or a very large first page, can be sold without a sample.
 if(pages<1)return null;
 const path=book.id+'/sample-'+crypto.randomUUID()+'.pdf';
 let r;try{r=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/ebook-previews/'+path,{
  method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/pdf'},body:bytes,signal:AbortSignal.timeout(20000)
 });}catch{throw unavailable();}
 if(!r.ok)throw unavailable();
 return path;
}
export async function pdfFiles(book,{fullBytes,sampleBytes,replacePreview=false}={}){
 const full=await openPdf(fullBytes||await storedBytes('ebook-pdfs',book.pdf_path,uploadKinds.pdf.max,'PDF kamili'));
 let preview=book.preview_path||null;
 if(preview&&!replacePreview&&full.getPageCount()>1){
  let sample;try{const bytes=sampleBytes||await storedBytes('ebook-previews',preview,uploadKinds.preview.max,'Sampuli');sample=await openPdf(bytes,'Sampuli');}catch(e){if(e.status!==400)throw e;}
  if(sample&&sample.getPageCount()<=4&&sample.getPageCount()<full.getPageCount())return {page_count:full.getPageCount(),preview_path:preview};
 }
 // Never offer the full paid book as a sample. Generate only its opening pages.
 preview=await automaticPreview(book,full);
 return {page_count:full.getPageCount(),preview_path:preview};
}
export async function verifyCover(bytes){
 try{const {default:sharp}=await import('sharp');const info=await sharp(bytes).metadata();if(!['png','jpeg','webp'].includes(info.format)||!info.width||!info.height)throw Error('format');}
 catch(e){throw new HttpError(400,/pixel limit/i.test(e.message)?'Jalada lina vipimo vikubwa sana. Punguza vipimo vya picha kisha ujaribu tena.':'Jalada halifunguki kama picha. Tumia PNG, JPG au WebP.');}
}
