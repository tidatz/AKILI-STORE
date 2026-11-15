# AKILI STORE — uthibitisho wa utendaji na maandalizi ya marketing

15 Novemba 2026 · Mradi: tidatz/AKILI-STORE · www.akilistore.com

## Mtiririko unaohakikiwa

Msomaji anafungua link ya jina la kitabu, anaona sampuli na bei, anaweka taarifa, analipia kupitia Snippe, kisha anasoma au kupakua. Akaunti yenye email iliyothibitishwa inaunganisha kitabu na maktaba. Admin anasimamia waandishi, roles na access; mwandishi anapakia rasimu, anachapisha moja kwa moja bila kusubiri admin na anaona mauzo halisi.

## Vipengele na ushahidi

| Sehemu | Tabia iliyokamilishwa | Uthibitisho |
| --- | --- | --- |
| Malipo → kitabu | Bei ya server, idempotency, webhook yenye saini, uthibitishaji wa provider, receipt, Soma na Pakua | Vipimo vya pending/paid/failed, amount mismatch, retries na manunuzi halisi yaliyokuwepo |
| Guest checkout | Jina, email na simu bila kulazimisha akaunti; Soma inaonekana kwa guest aliyelipa kwenye tab hiyo | DOM flow na capability authorization tests |
| Akaunti na maktaba | Verified email binding, session refresh, callback na password recovery zinarudisha ukurasa, query na sehemu husika | Auth tests, DOM na database |
| Roles na akaunti | Reader, Author na Admin; soft delete na restore; admin wa mwisho haondolewi | RPC tests chini ya service_role ndani ya transaction iliyorudishwa nyuma |
| Access | Grant/revoke tofauti na malipo; haiundi paid order au mapato | DB transaction na API tests |
| Waandishi | Mwaliko wa email; reusable link zenye expiry, quota, revocation na acceptance ya mara moja kwa account | RPC na API tests; hakuna invitation email ya majaribio iliyotumwa |
| Usalama wa mialiko | Server inathibitisha token na confirmed email; RPC hutumia profile inayosawazishwa na server | Auth rejection tests; hakuna SELECT ya auth.users iliyotolewa kwa service_role |
| Uchapishaji | Jalada, full PDF na sample tofauti hukaguliwa; idadi ya kurasa hupimwa kutoka PDF | PDF tests; full PDF haiwezi kuchapishwa kama sample |
| Editor ya mwandishi | Published book hulindwa dhidi ya kubadilishwa na mwandishi; rasimu na zilizowahi kuwasilishwa zinaweza kuchapishwa moja kwa moja; admin anasimamia mabadiliko | DOM kwa author/admin |
| Kushare | Public named URL na clipboard/native share; reader token haishirikishwi | Share tests na ukaguzi wa browser |
| Muonekano | Mitindo sita, Light/Dark/Normal; admin anadhibiti default ya kudumu ya mfumo; personal choice ni session ya dakika 30 bila matumizi; reduced motion | Enum/API tests, mode combinations na browser |
| Footer na forms | Footer haionekani kwenye dashboard, reader, auth, checkout na receipt; hakuna placeholders za mifano | DOM kwa guest, reader, author na admin |
| Loading | Logo halisi, Welcome, AKILI STORE na pen/underline; mara moja kwa tab | Browser |
| Marketing | Canonical URL, OG/Twitter previews, Book/WebSite structured data na dynamic sitemap ya published books | SEO tests; private pages zina noindex na no-store |
| Deployment | Landing inapitia metadata ya server; static SPA shell haizuii homepage rewrite | Ukaguzi wa HTTP wa production ulibaini precedence ya index.html; build hutenganisha shell kwenye dist |
| Copy ya kitabu | Maelezo na mada saba zimetokana na PDF halisi; landing inabaki fupi | akili-store-mifumo-7.pdf, kurasa 1–9 |
| SMS | Muunganisho wa admin, preview kabla ya kutuma, idempotency na delivery-signature validation | Provider mocks na security tests; hakuna SMS ya majaribio iliyotumwa |

## Mabadiliko ya database yaliyotumika

- `supabase/experience.sql`: grants, author links, acceptances, appearance, soft deletion na routines za usimamizi.
- `supabase/experience_auth_fix.sql`: marekebisho yaliyotumika kwenye mialiko ya awali; tayari yamejumuishwa kwenye experience.sql kwa installation mpya.
- `supabase/readiness_indexes.sql`: covering indexes 13; advisor haionyeshi tena foreign keys zisizo na indexes.
- `supabase/marketing_update.sql`: maelezo ya bidhaa na yaliyomo, pamoja na version/audit; bei na files hazibadilishwi.
- `supabase/experience_verify.sql`: fixtures, role changes, grant/revoke, delete/restore na invite checks zote zinarudishwa nyuma baada ya kupimwa. Hakuna akaunti ya majaribio inayobaki.

Tables mpya zina RLS, hakuna anon/authenticated table access, na RPC ni SECURITY INVOKER zenye EXECUTE ya service_role pekee. Ledger na rekodi za miamala hazibadilishwi na usimamizi wa roles au manual book access.

## Validation

Vipimo 115 vya server/auth/payment/security/SEO vimepita, pamoja na syntax checks, build, DOM flows na database transaction checks. npm audit haikuonyesha vulnerabilities. Ukaguzi wa browser na HTTP wa production unahakiki rendering, metadata, redirects, private headers na upatikanaji wa kitabu kilicholipiwa.

Hakuna mobile-money charge, payout, bulk SMS, ad au ujumbe wa majaribio kwa mtu mwingine uliotumwa na ukaguzi huu. Vipimo vya provider vinatumia mocks; manunuzi halisi yaliyokuwepo yamehakikiwa bila kubuni paid status.

## Mambo ya nje yanayobaki tofauti na utendaji wa duka

- Buyer receipt email ya Resend bado haijaunganishwa. Msomaji anapata kitabu kwenye receipt page na maktaba bila huduma hiyo.
- SMS delivery reports zinahitaji webhook signing secret ya eHub ikiwa bado haijahifadhiwa; bila hiyo, hali isiyothibitishwa haionyeshwi kama delivered.
- Google OAuth consent branding ni mpangilio wa Google/Supabase wa nje. Hakuna scope mpya au credential iliyoanzishwa wakati wa ukaguzi huu.
- Supabase leaked password protection ina WARN. RLS-without-policy INFO ni ya tables za server pekee; unused-index INFO inatarajiwa kwa indexes mpya.
- Huu ni uthibitisho wa kiufundi wa vipengele na ushahidi ulioelezwa. Hauwakilishi cheti cha mamlaka au ahadi ya nafasi kwenye search engines.

## Maboresho ya 15 Novemba — PDF na uchapishaji wa moja kwa moja

- Faili hutambuliwa kwa bytes badala ya kutegemea MIME ya simu. PDF zenye BOM au header ya scanner zinakubaliwa. Faili bovu au lenye nenosiri halitajwi kama hitilafu ya mtandao.
- Upakiaji una progress, retry ya muda kwa signed path ileile, na button ya kujaribu tena. PDF lililopakiwa tayari halitumwi upya kama hatua ya kuambatisha pekee ndiyo iliyokwama.
- Rasimu huundwa yenyewe faili likichaguliwa; hakuna sharti la Hifadhi rasimu kabla ya kuchagua mafaili. Kila faili linaambatishwa kwa update ya field husika ili lisiondoe faili jingine au maandishi ambayo bado yanaandikwa.
- Kurasa hupimwa kutoka PDF. Sampuli ni ya hiari na hutengenezwa kutoka kurasa za mwanzo pekee; kitabu kizima kilichowekwa kama sampuli kinabadilishwa kuwa sampuli fupi. PDF kamili na sampuli hubaki kwenye buckets binafsi.
- Mwandishi aliyeidhinishwa akibofya Chapisha kitabu, server huhakiki mafaili na kuweka published bila hali ya kusubiri admin. Admin ana button moja ya kuchapisha kutoka orodha au editor.
- Muonekano wa account uliohifadhiwa zamani hautawali duka tena. Admin default husawazishwa kwenye kurasa na PDF reader; personal choice hurudi kwa default kwenye session mpya au baada ya dakika 30 bila matumizi.
- Vipimo vya backend, aina za faili, sample generation, role boundaries, TTL ya muonekano na DOM ya author/admin vimepita. Hakuna malipo au SMS ya jaribio iliyoanzishwa.
