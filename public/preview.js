// UI-ONLY preview: no API calls, no credentials, no real payments.
const $=s=>document.querySelector(s);
const book={title:'Mifumo 7 Muhimu Kila Biashara Inayohitaji Ili Kufanikiwa',price_tzs:25000};
const price=n=>'TSh '+Number(n).toLocaleString('en-US');
const banner=document.createElement('div');
banner.className='preview-banner';
banner.innerHTML='<strong>UI PREVIEW</strong><span>Onyesho la muonekano pekee · Hakuna malipo halisi</span><span><a href="/">Duka</a> · <a href="/admin.html">Admin</a> · <a href="/reader.html">Reader</a></span>';
document.body.prepend(banner);
$('#hero').hidden=false;$('#book-title').textContent=book.title;$('#cover-fallback').textContent=book.title;$('#price').textContent=price(book.price_tzs);
$('#brand-name').textContent='eBook';
document.title='eBook Preview · Mifumo 7';
$('#buy').onclick=()=>{$('#checkout-title').textContent=book.title;$('#checkout-price').textContent=price(book.price_tzs);$('#checkout-modal').showModal()};
$('#menu-button').onclick=()=>{$('#menu').hidden=!$('#menu').hidden;$('#menu-button').setAttribute('aria-expanded',String(!$('#menu').hidden))};
for(const title of ['Kuhusu Kitabu','Kuhusu Mwandishi','Yaliyomo','Mawasiliano']){
 const b=document.createElement('button');b.textContent=title;b.onclick=()=>{$('#info-title').textContent=title;$('#info-content').textContent='Maudhui yatawekwa na Admin kwenye website halisi.';$('#info-modal').showModal();$('#menu').hidden=true};$('#menu').append(b);
}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$('#'+b.dataset.close).close();
for(const d of document.querySelectorAll('dialog'))d.onclick=e=>{if(e.target===d)d.close()};
$('#checkout-form').onsubmit=e=>{e.preventDefault();$('#checkout-error').hidden=false;$('#checkout-error').textContent='UI PREVIEW tu — hakuna malipo yatakayofanyika.'};
