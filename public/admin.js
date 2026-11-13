const $=s=>document.querySelector(s);
const money=n=>'TSh '+Number(n).toLocaleString('en-US');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config=null,session=null,data=null,selectedId=null;
const key='ebook-admin-session';
const showError=(s,element='#admin-alert')=>{const el=$(element);el.textContent=s;el.hidden=false;el.className=element==='#admin-alert'?'notice':'error'};
const clearError=(element='#admin-alert')=>{$(element).hidden=true};
async function configLoad(){
  const r=await fetch('/api?action=config');config=await r.json();
}
async function loginApi(grant,body){
  if(!config?.supabase_url||!config?.publishable_key)throw Error('Supabase Auth haijasanidiwa kwenye server.');
  const r=await fetch(config.supabase_url+'/auth/v1/token?grant_type='+grant,{
    method:'POST',headers:{apikey:config.publishable_key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json();
  if(!r.ok)throw Error(result.error_description||result.msg||result.message||'Login imeshindikana.');
  session={access_token:result.access_token,refresh_token:result.refresh_token,
    email:grant==='password'?body.email:session?.email};
  sessionStorage.setItem(key,JSON.stringify(session));return session;
}
async function adminApi(action,body,retried=false){
  if(!session?.access_token)throw Error('Ingia kwanza.');
  const r=await fetch('/api?action=admin-'+action,{method:body?'POST':'GET',headers:{
    Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(r.status===401&&!retried&&session.refresh_token){
    await loginApi('refresh_token',{refresh_token:session.refresh_token});
    return adminApi(action,body,true);
  }
  const result=await r.json();
  if(!r.ok)throw Error(result.error||'Server error');return result;
}
function logout(){
  session=null;sessionStorage.removeItem(key);$('#admin-screen').hidden=true;$('#login-screen').hidden=false;
}
function panel(which){
  for(const el of document.querySelectorAll('.panel'))el.hidden=el.id!=='panel-'+which;
  for(const button of document.querySelectorAll('#admin-nav button'))button.classList.toggle('active',button.dataset.panel===which);
}
$('#admin-nav').onclick=e=>{const b=e.target.closest('button[data-panel]');if(b)panel(b.dataset.panel)};
$('#logout').onclick=logout;
$('#login-form').onsubmit=async e=>{
  e.preventDefault();clearError('#login-error');
  const form=e.target;const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
    await loginApi('password',Object.fromEntries(new FormData(form)));
    await loadAdmin();form.reset();
  }catch(ex){logout();showError(ex.message,'#login-error')}
  finally{button.disabled=false}
};
async function loadAdmin(){
  data=await adminApi('data');
  $('#login-screen').hidden=true;$('#admin-screen').hidden=false;
  $('#admin-email').textContent=session.email||'Authenticated Admin';
  updateBooks();updateSite();updateSales();updateSettings();
  panel('books');
}
async function refresh(){data=await adminApi('data');updateBooks();updateSite();updateSales();updateSettings()}
function bookSelect(id){selectedId=id;updateBooks()}
function updateBooks(){
  const container=$('#book-choices');container.replaceChildren();
  if(selectedId&&selectedId!=='new'&&!data.books.some(b=>b.id===selectedId))selectedId=null;
  if(!selectedId&&data.books.length)selectedId=data.books[0].id;
  for(const b of data.books){
    const btn=document.createElement('button');btn.className='book-choice'+(selectedId===b.id?' active':'');
    btn.type='button';
    const title=document.createElement('span');title.textContent=b.title;
    const status=document.createElement('span');status.className='pill';status.textContent=b.status+(b.featured?' · Homepage':'');
    btn.append(title,status);btn.onclick=()=>bookSelect(b.id);container.append(btn);
  }
  const b=data.books.find(x=>x.id===selectedId)||{id:'',title:'',slug:'',subtitle:'',price_tzs:25000,description:'',
    status:'draft',featured:false,cover_path:'',pdf_path:''};
  const form=$('#book-form');
  for(const name of ['id','title','slug','subtitle','description','price_tzs','status','cover_path','pdf_path'])form.elements.namedItem(name).value=b[name]??'';
  form.elements.namedItem('featured').checked=!!b.featured;
  $('#book-editor-title').textContent=b.id?'Hariri Kitabu':'Ongeza Kitabu';
  $('#delete-book').hidden=!b.id;
  $('#cover-file').disabled=!b.id;$('#pdf-file').disabled=!b.id;
  $('#book-upload-note').textContent=b.id?'Cover: '+(b.cover_path?'imepakiwa':'haipo')+' · PDF: '+(b.pdf_path?'imepakiwa':'haipo')+' — Bonyeza Hifadhi Kitabu baada ya kupakia.':
    'Hifadhi kitabu kwanza ili upakie cover na PDF.';
}
$('#add-book').onclick=()=>{selectedId='new';updateBooks()};
$('#book-form').onsubmit=async e=>{
  e.preventDefault();clearError();
  const form=e.currentTarget,v=Object.fromEntries(new FormData(form));
  v.featured=form.elements.namedItem('featured').checked;
  v.price_tzs=Number(v.price_tzs);
  if(!v.id)delete v.id;
  try{
    const r=await adminApi('book',v);
    selectedId=r.book.id;showError('Kitabu kimehifadhiwa.');
    await refresh();
  }catch(ex){showError('Imeshindikana: '+ex.message)}
};
$('#delete-book').onclick=async()=>{
  if(!selectedId||!confirm('Futa kitabu hiki? Hatua hii haiwezi kurudishwa.'))return;
  try{await adminApi('delete',{id:selectedId});selectedId=null;await refresh();showError('Kitabu kimefutwa.')}
  catch(ex){showError(ex.message)}
};
async function upload(kind,file,bookId){
  if(!file)return;
  clearError();
  const request={kind,mime:file.type,size:file.size};
  if(bookId)request.bookId=bookId;
  const signed=await adminApi('upload',request);
  const response=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  if(!response.ok)throw Error('Upload imeshindikana. HTTP '+response.status);
  return signed.path;
}
for(const [kind,inputName,field] of [['cover','cover-file','cover_path'],['pdf','pdf-file','pdf_path']]){
  $('#'+inputName).onchange=async e=>{
    const file=e.target.files[0];if(!file||!selectedId||selectedId==='new')return;
    try{
      const path=await upload(kind,file,selectedId);
      $('#book-form').elements.namedItem(field).value=path;
      showError(kind.toUpperCase()+' imepakiwa. Bonyeza HIFADHI KITABU kuhifadhi mabadiliko.');
    }catch(ex){showError(ex.message)}
  };
}
function updateSite(){
  const form=$('#site-form');
  for(const [name,value] of Object.entries(data.settings||{})){
    const el=form.elements.namedItem(name);if(el)el.value=value??'';
  }
  $('#preview-box').hidden=true;
}
for(const [kind,inputName,field] of [['logo','logo-file','logo_path'],['favicon','favicon-file','favicon_path']]){
  $('#'+inputName).onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      const path=await upload(kind,file);
      $('#site-form').elements.namedItem(field).value=path;
      showError(kind+' imepakiwa. Bonyeza PUBLISH CHANGES.');
    }catch(ex){showError(ex.message)}
  };
}
$('#site-form').onsubmit=async e=>{
  e.preventDefault();clearError();
  const v=Object.fromEntries(new FormData(e.currentTarget));
  try{await adminApi('site',v);await refresh();showError('Mabadiliko yamechapishwa bila redeployment.')}
  catch(ex){showError(ex.message)}
};
$('#preview-site').onclick=()=>{
  const s=Object.fromEntries(new FormData($('#site-form')));
  const book=data.books.find(b=>b.featured)||data.books[0];
  const holder=$('#preview-content');holder.replaceChildren();
  holder.style.color=s.text_color||'#121826';
  holder.style.fontFamily=s.font_style==='serif'?'Georgia,serif':'system-ui,sans-serif';
  const heading=document.createElement('strong');heading.textContent=s.site_name||'eBook';
  const title=document.createElement('h2');title.textContent=book?.title||'Kitabu';
  const price=document.createElement('p');price.textContent=book?money(book.price_tzs):'';
  const button=document.createElement('button');button.textContent=s.buy_label||'NUNUA SASA';
  button.className='primary-button';button.style.background=s.primary_color;button.style.borderColor=s.primary_color;button.disabled=true;
  const small=document.createElement('p');small.className='muted';small.textContent='Hakuna taarifa zinazohifadhiwa mpaka ubofye PUBLISH CHANGES.';
  holder.append(heading,title,price,button,small);$('#preview-box').hidden=false;
};
function updateSales(){
  const term=$('#sales-search').value.trim().toLowerCase();
  const payments=new Map(data.payments.map(x=>[x.order_id,x]));
  const downloads=new Map();
  for(const x of data.events)if(x.event_type==='download_request')downloads.set(x.order_id,(downloads.get(x.order_id)||0)+1);
  const books=new Map(data.books.map(x=>[x.id,x.title]));
  const body=$('#sales-rows');body.replaceChildren();
  for(const order of data.orders){
    if(term&&!([order.id,order.customer_name,order.customer_email,order.customer_phone].some(x=>String(x||'').toLowerCase().includes(term))))continue;
    const tr=document.createElement('tr');
    const values=[new Date(order.created_at).toLocaleDateString('sw-TZ'),order.customer_name+' · '+order.customer_email,
      books.get(order.book_id)||'—',money(order.amount_tzs),order.status,
      payments.get(order.id)?.status||'—',downloads.get(order.id)||0];
    for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td)}
    const actions=document.createElement('td');
    const verify=document.createElement('button');verify.className='tiny-button';verify.textContent='Verify';
    verify.onclick=async()=>{try{const x=await adminApi('verify',{orderId:order.id});await refresh();showError('Provider status: '+x.status)}
      catch(e){showError(e.message)}};
    actions.append(verify);
    if(order.status==='paid'){
      const resend=document.createElement('button');resend.className='tiny-button';resend.textContent='Tuma Access';
      resend.onclick=async()=>{try{await adminApi('resend',{orderId:order.id});await refresh();showError('Email imetumwa.')}
        catch(e){showError(e.message)}};
      actions.append(resend);
    }
    tr.append(actions);body.append(tr);
  }
}
$('#sales-search').oninput=updateSales;
function updateSettings(){
  const container=$('#integration-status');container.replaceChildren();
  const statuses=[['Database / Private Storage','storage'],['Snippe API','snippe'],['Snippe Webhook Secret','webhook'],['Email Access (Resend)','email']];
  for(const [label,key] of statuses){
    const row=document.createElement('div');row.className='status-row';
    const name=document.createElement('span');name.textContent=label;
    const status=document.createElement('span');status.textContent=data.status[key]?'Configured':'Missing';
    status.className='status-dot '+(data.status[key]?'okay':'missing');
    row.append(name,status);container.append(row);
  }
}
(async()=>{
  try{
    await configLoad();
    const saved=sessionStorage.getItem(key);
    if(saved){session=JSON.parse(saved);await loadAdmin()}
  }catch(e){logout();showError('Session haikuthibitishwa. Ingia tena.','#login-error')}
})();
