# AKILI STORE — ukaguzi wa mtiririko na muonekano

Tarehe: 14 Novemba 2026. Mradi: tidatz/AKILI-STORE, www.akilistore.com.

## Kilichorekebishwa

| Sehemu | Tabia mpya | Uthibitisho |
| --- | --- | --- |
| Kushare | Link ya `/book/jina-la-kitabu`, Web Share na njia ya kunakili; PDF tokens hazishirikishwi | API/unit na ukaguzi wa DOM |
| Link previews | Jina, maelezo mafupi, jalada na canonical kwenye HTML ya book page | Vipimo vya HTML escaping na private-path exclusion |
| Kuingia/kujisajili | Hifadhi ukurasa, query na sehemu ya ukurasa; msomaji huanza dukani; mwandishi na admin wana eneo lao | OAuth, email callback, safe return URL na DOM |
| Footer | Dukani na kurasa za taarifa; haionekani kwenye auth, checkout, purchase, dashboard na reader | DOM kwa guest, reader, author na admin |
| Ununuzi | Mgeni anaweka jina, email na simu bila akaunti; bei inasomwa server-side | Mock provider tests; hakuna malipo mapya ya majaribio yaliyotumwa |
| Baada ya malipo | Receipt, Soma na Pakua; guest token inahifadhiwa kwenye session ya browser; email iliyothibitishwa inaunganisha manunuzi na maktaba | Paid/pending/revoked/IDOR tests na guest DOM flow |
| Nunua → Soma | Access ya akaunti inabadilisha CTA kwenye landing, catalog na book page | DOM kwa reader mwenye kitabu |
| Reader | Progress, kupakua, native PDF fallback na kushare public book page | Existing paid flow + fallback/recovery tests |
| Loading | Logo halisi, Welcome, AKILI STORE, pen na underline; mara moja kwa tab; reduced motion | Source na ukaguzi wa browser |
| Muonekano | Mitindo sita; Dark, Light, Normal; mtindo mmoja pia kwenye reader | 18 validated combinations; DOM na browser |
| Form fields | Labels zinabaki; placeholders zote za mifano zimeondolewa | DOM kwenye routes za roles zote |
| Description | Rasimu ya bure inayotumia jina na mwandishi ndani ya browser | Haidai kutumia AI ya nje wala kubuni sura/ushuhuda |

## Mabadiliko ya database yanayosubiri idhini

Faili `supabase/experience.sql` limeandaliwa na halijatumika. Ukaguzi wa ruhusa wa kiotomatiki ulizuia Run query kwenye Supabase production baada ya onyo la destructive operations.

Mabadiliko hayo yanaongeza:

- `akili_book_grants` kwa kutoa na kuondoa access bila kuunda malipo.
- `akili_author_links` na acceptances kwa link zenye expiry, quota na revocation.
- `appearance` kwenye profile/settings na `deleted_at` kwenye profiles.
- RPC tatu za service_role pekee. Hakuna EXECUTE kwa PUBLIC, anon au authenticated. RLS imewashwa kwenye tables mpya.
- Ulinzi wa admin wa mwisho na wa kujifuta/kujisuspend; kufuta akaunti kunakuwa recoverable soft delete; miamala na ledger hazifutwi.

SQL huunda functions; body zake zinazobadili roles au access hazitekelezwi wakati wa kuunda schema. Zitatekelezwa tu admin anapoomba hatua husika baada ya uamilishaji.

Hadi idhini hiyo ipatikane, mfumo unatambua schema ya sasa: ununuzi uliopo na guest checkout vinaendelea; mitindo inahifadhiwa kwenye kifaa. Roles mpya, book grants, soft delete, reusable author links, na kuhifadhi muonekano kwa account/devices mbalimbali vinaonyesha hali ya kusubiri. Mialiko ya mwandishi inayofungamana na email inaendelea.

## Vipimo na mipaka

- Vipimo 79 vya server/auth/payment/security vimepita. Syntax checks, build, diff checks na npm audit pia zimepita; audit haikuonyesha vulnerabilities.
- DOM flows zimepimwa kwa guest, reader, author, admin, reader mwenye kitabu, na schema ya sasa isiyobadilishwa. Reader fallback na session recovery zimepita.
- Vipimo vya provider hutumia mocks; hakuna SMS, invitation email au mobile-money charge mpya iliyotumwa wakati wa ukaguzi huu.
- Miamala halisi iliyokuwepo imeachwa. Bei ya sasa ya kitabu iliyowekwa na admin ni TSh 500.
- Buyer receipt email ya Resend bado haijaunganishwa. Fulfillment ya ukurasa na maktaba inafanya kazi bila hiyo. Bulk SMS haijatumwa.
- Supabase advisor ina INFO kwa tables zenye RLS bila policies kwa sababu zinatumiwa na server pekee; leaked password protection ina WARN inayobaki. Google OAuth consent branding bado ni mpangilio wa nje wa Google/Supabase.
- Huu ni ukaguzi wa utekelezaji na vipimo vilivyoelezwa hapa. Hauwakilishi cheti cha ukaguzi wa mamlaka au tathmini ya kitaifa.

## Baada ya idhini ya schema

Tekeleza `supabase/experience.sql` kama transaction kwenye project iliyotajwa. Hakiki table privileges/RLS na RPCs; pima role/access/invite kwenye transaction inayorudishwa nyuma. Schema readiness huangaliwa tena ndani ya sekunde 45, hivyo features zilizotayarishwa hazihitaji kubadili secrets au kuunda malipo.
