const $=s=>document.querySelector(s);
const api=async(action,body)=>{const r=await fetch('/api?action='+encodeURIComponent(action),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw Error(j.error||'Tatizo la mfumo');return j};
const money=n=>'TSh '+Number(n).toLocaleString('en-US');
let site,book,interval=null;
const html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const menuItems=[['Kuhusu Kitabu','about_book','menu_about_book'],['Kuhusu Mwandishi','about_author','menu_about_author'],['Yaliyomo','contents','menu_contents'],['Mawasiliano','contact','menu_contact']];
function showInfo(title,value){$('#info-title').textContent=title;$('#info-content').textContent=value;$('#info-modal').showModal();$('#menu').hidden=true;$('#menu-button').setAttribute('aria-expanded','false')}
function render(b){
  book=b;if(!b){$('#hero').hidden=true;$('#notice').hidden=false;$('#notice').textContent='Hakuna kitabu kilichochapishwa kwa sasa.';return}
  $('#hero').hidden=false;
  $('#book-title').textContent=b.title;$('#cover-fallback').textContent=b.title;
  $('#book-subtitle').textContent=b.subtitle||'';$('#book-subtitle').hidden=!b.subtitle;
  $('#price').textContent=money(b.price_tzs);$('#buy').textContent=site.settings.buy_label||'NUNUA SASA';
  const cover=$('#book-cover');cover.querySelector('img')?.remove();
  if(b.cover_url){const img=document.createElement('img');img.alt='Jalada la '+b.title;img.src=b.cover_url;cover.append(img);$('#cover-fallback').hidden=true}else $('#cover-fallback').hidden=false;
  document.title=b.title;
  const nav=$('#menu');nav.replaceChildren();
  for(const [defaultLabel,key,menuKey] of menuItems){
    const label=site.settings[menuKey]||defaultLabel;
    const value=key==='about_book'?(b.description||site.settings.about_book):site.settings[key];
    if(!value?.trim())continue;
    const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.onclick=()=>showInfo(label,value);nav.append(btn);
  }
  $('#menu-button').hidden=nav.children.length===0;
  const isHome=location.pathname==='/'||location.pathname==='/index.html';
  $('#book-list').hidden=!isHome||site.books.length<2;
  if(!$('#book-list').hidden){
    const list=$('#book-links');list.replaceChildren();
    for(const item of site.books){
      const a=document.createElement('a');a.className='book-row';a.href='/book/'+encodeURIComponent(item.slug);
      const name=document.createElement('span');name.textContent=item.title;
      const price=document.createElement('span');price.textContent=money(item.price_tzs);a.append(name,price);list.append(a);
    }
  }
}
async function load(){
  try{
    site=await api('site');
    const s=site.settings||{};
    document.documentElement.style.setProperty('--accent',s.primary_color||'#1D4ED8');
    document.documentElement.style.setProperty('--ink',s.text_color||'#121826');
    if(s.font_style==='serif')document.documentElement.style.setProperty('--font','Georgia,Times New Roman,serif');
    $('#brand-name').textContent=s.site_name||'eBook';
    if(s.logo_url){$('#brand-logo').src=s.logo_url;$('#brand-logo').hidden=false;$('#brand-name').hidden=!!s.site_name===false}else $('#brand-logo').hidden=true;
    if(s.favicon_url){const l=document.createElement('link');l.rel='icon';l.href=s.favicon_url;document.head.append(l)}
    const slug=location.pathname.startsWith('/book/')?decodeURIComponent(location.pathname.split('/')[2]||''):null;
    render(slug?site.books.find(b=>b.slug===slug):site.featured);
    if(slug&&!book){$('#notice').hidden=false;$('#notice').textContent='Kitabu hiki hakipatikani.'}
  }catch(e){$('#notice').hidden=false;$('#notice').textContent='Imeshindikana kufungua duka: '+e.message}
}
$('#menu-button').onclick=()=>{$('#menu').hidden=!$('#menu').hidden;$('#menu-button').setAttribute('aria-expanded',String(!$('#menu').hidden))};
document.addEventListener('click',e=>{if(!$('#menu').hidden&&!e.target.closest('#menu,#menu-button'))$('#menu').hidden=true});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
$('#buy').onclick=()=>{if(!book)return;$('#checkout-title').textContent=book.title;$('#checkout-price').textContent=money(book.price_tzs);
  $('#checkout-error').hidden=true;$('#checkout-stage').hidden=false;$('#payment-stage').hidden=true;
  try{const cached=JSON.parse(sessionStorage.getItem('ebook-checkout')||'null');
    if(cached?.bookId===book.id&&cached?.orderId&&cached?.clientSecret){
      purchase=cached;$('#checkout-stage').hidden=true;$('#payment-stage').hidden=false;
      clearInterval(interval);interval=setInterval(checkPayment,5000);checkPayment();
    }}catch{}
  $('#checkout-modal').showModal()};
const err=msg=>{$('#checkout-error').hidden=false;$('#checkout-error').textContent=msg};
let purchase=null;
async function checkPayment(){
  if(!purchase)return;
  try{
    const status=await api('status',{orderId:purchase.orderId,clientSecret:purchase.clientSecret});
    if(status.status==='paid'){
      clearInterval(interval);interval=null;$('#payment-message').textContent='Malipo yamethibitishwa. Tunafungua kitabu...';
      const access=await api('claim',{orderId:purchase.orderId,clientSecret:purchase.clientSecret});
      sessionStorage.removeItem('ebook-checkout');sessionStorage.removeItem('ebook-attempt');location.href='/reader.html?token='+access.token;
    }else if(['failed','expired'].includes(status.status)){
      clearInterval(interval);interval=null;sessionStorage.removeItem('ebook-checkout');sessionStorage.removeItem('ebook-attempt');purchase=null;$('#payment-message').textContent='Malipo hayajakamilika ('+status.status+').';
    } else $('#payment-message').textContent='Tunasubiri uthibitisho kutoka Snippe. Thibitisha malipo kwenye simu yako.';
  }catch(e){err(e.message)}
}
$('#check-payment').onclick=checkPayment;
$('#checkout-form').onsubmit=async e=>{
  e.preventDefault();$('#checkout-error').hidden=true;
  const data=Object.fromEntries(new FormData(e.currentTarget));
  const btn=$('#pay');btn.disabled=true;btn.textContent='INAANZISHA...';
  try{
    const fingerprint=JSON.stringify([book.id,data.name.trim(),data.email.trim().toLowerCase(),data.phone.replace(/[^0-9]/g,'')]);
    let attempt;try{attempt=JSON.parse(sessionStorage.getItem('ebook-attempt')||'null')}catch{}
    if(!attempt||attempt.fingerprint!==fingerprint||Date.now()-attempt.createdAt>4*60*60*1000){
      const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
      const clientSecret=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
      attempt={fingerprint,checkoutId:crypto.randomUUID(),clientSecret,createdAt:Date.now()};
      sessionStorage.setItem('ebook-attempt',JSON.stringify(attempt));
    }
    const result=await api('checkout',{...data,bookId:book.id,checkoutId:attempt.checkoutId,clientSecret:attempt.clientSecret});
    purchase={orderId:result.orderId,clientSecret:attempt.clientSecret,bookId:book.id};
    sessionStorage.setItem('ebook-checkout',JSON.stringify(purchase));
    $('#checkout-stage').hidden=true;$('#payment-stage').hidden=false;
    $('#payment-message').textContent='Ombi limetumwa. Kamilisha malipo kwenye simu yako.';
    clearInterval(interval);interval=setInterval(checkPayment,5000);
  }catch(ex){err(ex.message)}
  finally{btn.disabled=false;btn.textContent='LIPA KWA SIMU'}
};
$('#checkout-modal').addEventListener('close',()=>{if(interval){clearInterval(interval);interval=null}});
load();
