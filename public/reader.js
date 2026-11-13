import {api} from './auth.js';
const $=s=>document.querySelector(s);
const token=new URLSearchParams(location.search).get('token');
const bookId=new URLSearchParams(location.search).get('book');
const message=s=>{$('#reader-message').textContent=s;$('#reader-message').hidden=false};
const request=async purpose=>{
  if(bookId)return api('market-access',{bookId,purpose});
  const response=await fetch('/api?action=access',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({token,purpose})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'PDF haipatikani.');
  return data;
};
let pdf=null,page=1,zoom=1,paint=null,desiredRender=0,details=null;
function updateButtons(){
  const ready=!!pdf;
  $('#prev').disabled=!ready||page<=1;
  $('#next').disabled=!ready||page>=pdf.numPages;
  $('#zoom-in').disabled=!ready||zoom>=2.5;
  $('#zoom-out').disabled=!ready||zoom<=.5;
  $('#download').disabled=!ready;
  $('#pages').textContent=ready?page+' / '+pdf.numPages:'— / —';
  $('#zoom-label').textContent=Math.round(zoom*100)+'%';
}
async function render(){
  if(!pdf)return;
  const renderId=++desiredRender;
  if(paint){try{paint.cancel();await paint.promise}catch{}}
  const current=await pdf.getPage(page);
  if(renderId!==desiredRender)return;
  const stage=$('#pdf-stage'),unit=current.getViewport({scale:1});
  const scale=Math.min(1.7,(stage.clientWidth-25)/unit.width)*zoom;
  const viewport=current.getViewport({scale});
  const canvas=$('#page-canvas'),context=canvas.getContext('2d');
  const ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.floor(viewport.width*ratio);
  canvas.height=Math.floor(viewport.height*ratio);
  canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
  canvas.hidden=false;$('#reader-message').hidden=true;
  paint=current.render({canvasContext:context,viewport,transform:[ratio,0,0,ratio,0,0]});
  try{await paint.promise;}catch(e){if(e?.name!=='RenderingCancelledException')message('Imeshindikana kuonyesha ukurasa.')}
  if(renderId===desiredRender)paint=null;
  updateButtons();
  if(bookId){clearTimeout(saveTimer);saveTimer=setTimeout(()=>api('market-progress',{bookId,page,total_pages:pdf.numPages}).catch(()=>{}),1000);}
}
let saveTimer;
$('#prev').onclick=()=>{if(page>1){page--;render()}};
$('#next').onclick=()=>{if(pdf&&page<pdf.numPages){page++;render()}};
$('#zoom-in').onclick=()=>{zoom=Math.min(2.5,Math.round((zoom+.25)*100)/100);render()};
$('#zoom-out').onclick=()=>{zoom=Math.max(.5,Math.round((zoom-.25)*100)/100);render()};
$('#download').onclick=async()=>{
  $('#download').disabled=true;
  try{
    const data=await request('download');
    const result=await fetch(data.url);
    if(!result.ok)throw Error('PDF haikupakuliwa.');
    const blob=await result.blob();
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=data.filename||'kitabu.pdf';
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){message(e.message)}
  finally{updateButtons()}
};
let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(render,200)});
async function openBook(){
  $('#retry-reader').hidden=true;
  if(!bookId&&!/^[a-f0-9]{64}$/.test(token||'')){message('Kiungo cha kitabu hakipo au si sahihi.');return}
  try{
    details=await request('read');
    $('#reader-title').textContent=details.title;document.title=details.title;
    const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    pdf=await pdfjs.getDocument({url:details.url}).promise;
    if(bookId)page=Math.min(pdf.numPages,Math.max(1,details.page||1));
    updateButtons();await render();
  }catch(e){message(e.message||'Imeshindikana kufungua PDF.');$('#retry-reader').hidden=false;}
}
$('#retry-reader').onclick=openBook;
openBook();
