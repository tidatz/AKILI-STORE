let configPromise,refreshPromise;
const storageKey='akili-session';
const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};
export const session=()=>parse(sessionStorage.getItem(storageKey));
export const saveSession=s=>{if(!s?.access_token)return;sessionStorage.setItem(storageKey,JSON.stringify({access_token:s.access_token,refresh_token:s.refresh_token,expires_at:Date.now()+(s.expires_in||3600)*1000}));};
export async function config(){
 if(!configPromise)configPromise=fetch('/api?action=config').then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||'Huduma haipatikani.');return j;}).catch(e=>{configPromise=null;throw e;});
 return configPromise;
}
async function auth(path,body,token){
 const c=await config();if(!c.supabase_url||!c.publishable_key)throw Error('Huduma ya akaunti haipatikani kwa sasa.');
 const r=await fetch(c.supabase_url+'/auth/v1/'+path,{method:body?'POST':'GET',headers:{apikey:c.publishable_key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json().catch(()=>({}));if(!r.ok){const e=Error(j.error_description||j.msg||j.message||'Imeshindikana. Jaribu tena.');e.status=r.status;throw e;}return j;
}
export async function api(action,body,retry=true){
 let s=session();
 if(s?.refresh_token&&s.expires_at<Date.now()+60000)await refresh();
 s=session();
 const r=await fetch('/api?action='+encodeURIComponent(action),{method:body?'POST':'GET',headers:{...(s?.access_token?{Authorization:'Bearer '+s.access_token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(r.status===401&&retry&&s?.refresh_token){await refresh();return api(action,body,false);}
 const j=await r.json().catch(()=>({error:'Huduma haipatikani. Tafadhali jaribu tena.'}));
 if(!r.ok){const e=Error(j.error||'Imeshindikana. Jaribu tena.');e.status=r.status;throw e;}return j;
}
async function refresh(){
 if(!refreshPromise)refreshPromise=(async()=>{
  const s=session();
  if(!s?.refresh_token){const e=Error('Muda wa kuingia umeisha. Ingia tena.');e.status=401;throw e;}
  try{saveSession(await auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token}));}
  catch(error){
   if([400,401,403].includes(error.status)){
    sessionStorage.removeItem(storageKey);const e=Error('Muda wa kuingia umeisha. Ingia tena.');e.status=401;throw e;
   }
   // A temporary outage must not discard a valid session or a saved checkout.
   const e=Error('Huduma ya akaunti haijapatikana. Jaribu tena.');e.status=error.status||503;throw e;
  }
 })().finally(()=>{refreshPromise=null;});
 return refreshPromise;
}
export async function login(email,password){saveSession(await auth('token?grant_type=password',{email,password}));}
export async function register(email,password,name){
 const result=await auth('signup?redirect_to='+encodeURIComponent(location.origin+'/auth/callback'),{email,password,data:{full_name:name}});
 if(result.access_token)saveSession(result);return !!result.access_token;
}
export async function signout(){const s=session();sessionStorage.removeItem(storageKey);if(s?.access_token)await auth('logout?scope=local',{},s.access_token).catch(()=>{});}
export async function authSettings(){try{return await auth('settings');}catch{return {};}}
export async function googleLogin(next=''){
 const c=await config();const bytes=crypto.getRandomValues(new Uint8Array(32));
 const verifier=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 sessionStorage.setItem('akili-pkce',verifier);if(next)sessionStorage.setItem('akili-next',safeNext(next));else sessionStorage.removeItem('akili-next');
 const params=new URLSearchParams({provider:'google',redirect_to:location.origin+'/auth/callback',code_challenge:challenge,code_challenge_method:'s256',prompt:'select_account'});
 location.assign(c.supabase_url+'/auth/v1/authorize?'+params);
}
export function safeNext(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\x00-\x20]/.test(value)?value:'/my-library';}
export async function callback(){
 const query=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.slice(1));
 const error=query.get('error_description')||hash.get('error_description');
 if(error){history.replaceState({},'',location.pathname);throw Error(error);}
 if(query.has('code')){
   const verifier=sessionStorage.getItem('akili-pkce');if(!verifier)throw Error('Fungua tena kuingia kwenye browser uliyotumia kuanzisha.');
   saveSession(await auth('token?grant_type=pkce',{auth_code:query.get('code'),code_verifier:verifier}));sessionStorage.removeItem('akili-pkce');
 }else if(hash.has('access_token'))saveSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_in:Number(hash.get('expires_in'))||3600});
 const recovery=hash.get('type')==='recovery';history.replaceState({},'',location.pathname);
 const next=sessionStorage.getItem('akili-next');sessionStorage.removeItem('akili-next');
 return {recovery,next:next?safeNext(next):null};
}
export async function recover(email){return auth('recover?redirect_to='+encodeURIComponent(location.origin+'/auth/callback'),{email});}
export async function changePassword(password){
 const c=await config(),s=session();if(!s)throw Error('Fungua kiungo kilichotumwa kwenye email yako kwanza.');
 const r=await fetch(c.supabase_url+'/auth/v1/user',{method:'PUT',headers:{apikey:c.publishable_key,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({password})});
 if(!r.ok)throw Error('Nenosiri halijabadilishwa. Fungua kiungo kipya kutoka email yako.');
}
