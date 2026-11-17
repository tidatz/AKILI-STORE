import {api,session} from './auth.js';
import {shareBook} from './share.js';
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

  $('#share-book').disabled=!details?.slug;
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
  if(!bookId&&details?.slug){try{localStorage.setItem('akili-guest-progress-'+details.slug,JSON.stringify({page,total:pdf.numPages}));}catch{}}
  if(bookId){clearTimeout(saveTimer);saveTimer=setTimeout(()=>api('market-progress',{bookId,page,total_pages:pdf.numPages}).catch(()=>{}),1000);}
}
let saveTimer;
$('#prev').onclick=()=>{if(page>1){page--;render()}};
$('#next').onclick=()=>{if(pdf&&page<pdf.numPages){page++;render()}};
$('#zoom-in').onclick=()=>{zoom=Math.min(2.5,Math.round((zoom+.25)*100)/100);render()};
$('#zoom-out').onclick=()=>{zoom=Math.max(.5,Math.round((zoom-.25)*100)/100);render()};
let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(render,200)});
async function openBook(){
  $('#retry-reader').hidden=true;
  if(!bookId&&!/^[a-f0-9]{64}$/.test(token||'')){message('Kiungo cha kitabu hakipo au si sahihi.');return}
  try{
    details=await request('read');
    $('#reader-title').textContent=details.title;document.title=details.title+' | AKILI STORE';
    if(!bookId){let progress;try{progress=JSON.parse(localStorage.getItem('akili-guest-progress-'+details.slug)||'null');}catch{}page=progress?.page||1;}
    updateButtons();
    const pdfjs=await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
    pdf=await pdfjs.getDocument({url:details.url}).promise;
    page=Math.min(pdf.numPages,Math.max(1,bookId?details.page||1:page));
    updateButtons();await render();
  }catch(e){
    if(e.status===401){message('Ingia kwa akaunti uliyotumia kununua kitabu.');const login=$('#reader-login');login.href='/login?next='+encodeURIComponent(location.pathname+location.search);login.hidden=false;}
    else message(details?'Msomaji hajafunguka. Jaribu tena au wasiliana na msaada.':e.message||'Imeshindikana kufungua PDF.');
    $('#retry-reader').hidden=false;updateButtons();
  }
}
$('#retry-reader').onclick=openBook;
openBook();
