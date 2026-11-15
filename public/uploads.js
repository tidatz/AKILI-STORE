const limits={cover:10485760,pdf:52428800,preview:10485760};
export async function uploadMime(file,kind){
 if(!limits[kind])throw Error('Aina ya faili haijatambulika.');
 if(!file.size||file.size>limits[kind])throw Error(kind==='pdf'?'PDF kamili liwe hadi MB 50.':'Jalada au sampuli iwe hadi MB 10.');
 const bytes=new Uint8Array(await file.slice(0,1024).arrayBuffer());
 const text=new TextDecoder('latin1').decode(bytes);
 if(kind!=='cover'){
  if(text.includes('%PDF-'))return 'application/pdf';
  throw Error('Faili hili halijatambulika kama PDF. Chagua PDF ya kitabu.');
 }
 if(bytes[0]===137&&text.slice(1,4)==='PNG')return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(text.startsWith('RIFF')&&text.slice(8,12)==='WEBP')return 'image/webp';
 throw Error('Chagua picha ya PNG, JPG au WebP kwa jalada.');
}
export async function uploadBinary(url,file,mime,onProgress=()=>{}){
 for(let attempt=0;attempt<3;attempt++){
  try{
   await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.timeout=180000;
    xhr.setRequestHeader('Content-Type',mime);xhr.setRequestHeader('x-upsert','true');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else{const e=Error(xhr.status===413?'Faili limezidi ukubwa unaoruhusiwa.':'Huduma ya kupakia haijapokea faili.');e.retryable=xhr.status===408||xhr.status===429||xhr.status>=500;reject(e);}};
    xhr.onerror=xhr.ontimeout=()=>{const e=Error('Muunganisho umekatika wakati wa kupakia.');e.retryable=true;reject(e);};
    xhr.send(file);
   });return;
  }catch(e){if(!e.retryable||attempt===2)throw Error(e.message+' Chagua Jaribu tena ili kuendelea.');onProgress(0);}
 }
}
