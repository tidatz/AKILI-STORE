/* Before-paint store defaults; personal choices last only for this browser session. */
(function(){
 const designs=['classic','monochrome','glass','illustrative','soft','skeuomorphic'],modes=['normal','light','dark'];
 const key='akili-appearance-session',ttl=30*60*1000;
 let personal={},expires=0,defaults={design:'classic',mode:'normal'},color='#1D4ED8',lastTouch=0,refreshing=null;
 const valid=v=>v&&designs.includes(v.design)&&modes.includes(v.mode);
 try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(valid(saved?.value)&&saved.expires>Date.now()){personal=saved.value;expires=saved.expires;}const cached=JSON.parse(localStorage.getItem('akili-store-appearance')||'null');if(valid(cached))defaults=cached;color=localStorage.getItem('akili-store-color')||color;localStorage.removeItem('akili-appearance');}catch{}
 const media=window.matchMedia?.('(prefers-color-scheme: dark)');
 function persist(){try{if(personal.design)sessionStorage.setItem(key,JSON.stringify({value:personal,expires}));else sessionStorage.removeItem(key);}catch{}}
 function active(){if(expires<=Date.now()){personal={};expires=0;persist();}return personal.design?personal:defaults;}
 function apply(){
  const value=active(),root=document.documentElement;
  root.dataset.design=value.design;root.dataset.mode=value.mode;
  root.dataset.theme=value.mode==='dark'||value.mode==='normal'&&media?.matches?'dark':'light';root.style.colorScheme=root.dataset.theme;
  if(/^#[a-f0-9]{6}$/i.test(color)){
   const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4),lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
   root.style.setProperty('--accent',color);root.style.setProperty('--button',color);root.style.setProperty('--on-button',1.05/(lum+.05)>=4.5?'#fff':'#01103b');
  }
 }
 function setDefaults(value,newColor){if(valid(value))defaults=value;if(/^#[a-f0-9]{6}$/i.test(newColor||''))color=newColor;try{localStorage.setItem('akili-store-appearance',JSON.stringify(defaults));localStorage.setItem('akili-store-color',color);}catch{}apply();}
 async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{try{const r=await fetch('/api?action=appearance');if(r.ok){const v=await r.json();setDefaults(v.appearance,v.primary_color);}}catch{}finally{refreshing=null;}})();return refreshing;
 }
 window.akiliAppearance={apply,refresh,setDefaults,
  setPersonal(value){personal=valid(value)?{design:value.design,mode:value.mode}:{};expires=personal.design?Date.now()+ttl:0;lastTouch=Date.now();persist();apply();},
  personal(){active();return {...personal};},current(){return {...active()};}
 };
 function touch(){if(personal.design&&expires>Date.now()&&Date.now()-lastTouch>60000){lastTouch=Date.now();expires=lastTouch+ttl;persist();}}
 document.addEventListener('pointerdown',touch,{passive:true});document.addEventListener('keydown',touch);
 media?.addEventListener?.('change',apply);
 window.addEventListener('storage',e=>{if(e.key==='akili-store-appearance'||e.key==='akili-store-color'){try{const v=JSON.parse(localStorage.getItem('akili-store-appearance')||'null');if(valid(v))defaults=v;color=localStorage.getItem('akili-store-color')||color;}catch{}apply();}});
 window.addEventListener('focus',()=>{apply();refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();refresh();}});
 setInterval(()=>{apply();if(!document.hidden)refresh();},60000);
 apply();refresh();
})();
