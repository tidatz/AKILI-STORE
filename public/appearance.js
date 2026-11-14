/* Runs before paint; preferences contain presentation choices only. */
(function(){
 const designs=['classic','monochrome','glass','illustrative','soft','skeuomorphic'],modes=['normal','light','dark'];
 let personal={},defaults={design:'classic',mode:'normal'};
 try{personal=JSON.parse(localStorage.getItem('akili-appearance')||'{}');defaults=JSON.parse(localStorage.getItem('akili-store-appearance')||'null')||defaults;}catch{}
 const media=window.matchMedia?.('(prefers-color-scheme: dark)');
 function apply(){
   const value=personal?.design?personal:defaults,root=document.documentElement;
   root.dataset.design=designs.includes(value.design)?value.design:'classic';
   root.dataset.mode=modes.includes(value.mode)?value.mode:'normal';
   root.dataset.theme=value.mode==='dark'||value.mode==='normal'&&media?.matches?'dark':'light';
   root.style.colorScheme=root.dataset.theme;
 }
 window.akiliAppearance={
   apply,
   setPersonal(value){personal=value||{};try{localStorage.setItem('akili-appearance',JSON.stringify(personal));}catch{}apply();},
   setDefaults(value){if(value?.design)defaults=value;try{localStorage.setItem('akili-store-appearance',JSON.stringify(defaults));}catch{}apply();},
   personal(){return {...personal};},
   current(){return {...(personal?.design?personal:defaults)};}
 };
 media?.addEventListener?.('change',apply);
 window.addEventListener('storage',e=>{if(e.key==='akili-appearance'||e.key==='akili-store-appearance'){try{personal=JSON.parse(localStorage.getItem('akili-appearance')||'{}');defaults=JSON.parse(localStorage.getItem('akili-store-appearance')||'{}');}catch{}apply();}});
 apply();
})();
