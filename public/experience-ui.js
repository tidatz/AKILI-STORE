const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const designNames={classic:'AKILI STORE',monochrome:'Monochromatic',glass:'Glass Morphism',illustrative:'Illustrative',soft:'Neomorphism · Soft UI',skeuomorphic:'Skeuomorphic'};
export function appearanceFields(value={}){
 const design=value.design||'classic',mode=value.mode||'normal';
 return `<fieldset class="appearance-options"><legend>Mtindo wa muonekano</legend><div class="design-grid">${Object.entries(designNames).map(([key,label])=>`<label class="design-choice"><input type="radio" name="design" value="${key}" ${design===key?'checked':''} required><span class="design-sample" data-preview="${key}" aria-hidden="true"><i></i><b></b><em></em></span><span>${label}</span></label>`).join('')}</div></fieldset><label class="field">Mode<select name="mode"><option value="normal" ${mode==='normal'?'selected':''}>Normal · fuata kifaa changu</option><option value="light" ${mode==='light'?'selected':''}>Light · mwanga</option><option value="dark" ${mode==='dark'?'selected':''}>Dark · giza</option></select></label>`;
}
export function appearancePanel(value={},localOnly=false){
 return `<section class="panel appearance-panel"><h2>Muonekano wangu</h2><p class="muted small">Chagua mtindo wa duka na msomaji wa PDF. ${localOnly?'Chaguo lako linahifadhiwa kwenye kifaa hiki.':'Chaguo lako linahifadhiwa kwenye akaunti yako.'}</p><form id="appearance-form" class="form-stack">${appearanceFields(value)}<label class="check-row"><input type="checkbox" name="inherit" ${value.design?'':'checked'}> Tumia mwonekano wa kawaida wa duka</label><div id="form-error" class="error-box" role="alert" hidden></div><button type="submit" class="btn">Hifadhi muonekano</button></form></section>`;
}
export function authorJoin({label,expires_at},user,token){
 const next='/join-author?token='+token;
 return `<div class="container join-author"><p class="eyebrow">WAANDISHI · AKILI STORE</p><h1>Chapisha maarifa yako.</h1><p class="muted">${h(label)}</p><section class="panel"><h2>Jiunge kama mwandishi</h2><p>Utapata eneo la kupakia vitabu, kufuatilia mauzo na mapato. Vitabu vinapitiwa na admin kabla ya kuchapishwa.</p>${user?`<p class="muted small">Unaendelea kama ${h(user.email)}.</p><button class="btn block" type="button" data-action="accept-author-link" data-id="${h(token)}">Kubali na fungua dashboard</button>`:`<div class="button-row"><a class="btn" href="/register?next=${encodeURIComponent(next)}">Jisajili kama mwandishi</a><a class="btn secondary" href="/login?next=${encodeURIComponent(next)}">Nina akaunti · ingia</a></div>`}<p class="muted small">Kiungo kinaisha ${h(new Date(expires_at).toLocaleDateString('sw-TZ'))}.</p></section></div>`;
}
export function descriptionDraft(title,author){
 const name=String(title||'').trim(),writer=String(author||'').trim();
 if(name.length<3)throw Error('Jaza jina la kitabu kwanza.');
 // A free, local starter, deliberately without invented chapters, outcomes or testimonials.
 return `«${name}»${writer?' — '+writer:'.'}\n\nFahamu zaidi kuhusu ${name.replace(/[.!?]+$/,'')}. Soma sampuli ya kitabu ili kuona maudhui na mtindo wa uandishi kabla ya kufanya uamuzi wa kununua.`;
}
