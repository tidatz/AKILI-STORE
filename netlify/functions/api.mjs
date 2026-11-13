import crypto from 'node:crypto';
import {HttpError,sha,randomToken,isUuid,clean,supa,rows,insert,patch,remove,eq,one,assetUrl,signFile,adminUser,snippe,verifyWebhook,applyPayment,generateAccess,emailAccess} from './_lib.mjs';

const ok=(data,status=200)=>({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const fail=(status,message)=>ok({error:message},status);
const json=event=>{if((event.body||'').length>30000)throw new HttpError(413,'Data ni nyingi.');try{return JSON.parse(event.body||'{}')}catch{throw new HttpError(400,'JSON si sahihi.')}};
const uuid=id=>{if(!isUuid(id))throw new HttpError(400,'ID si sahihi.');return id};
const publishBook=b=>({id:b.id,slug:b.slug,title:b.title,subtitle:b.subtitle,description:b.description,price_tzs:b.price_tzs,cover_url:assetUrl(b.cover_path)});
const bookFields=['slug','title','subtitle','description','price_tzs','status','featured','cover_path','pdf_path'];
const siteFields=['site_name','logo_path','favicon_path','primary_color','text_color','font_style','buy_label','about_book','about_author','contents','contact'];

async function handle(event){
  const method=event.httpMethod;
  const action=new URLSearchParams(event.queryStringParameters?new URLSearchParams(event.queryStringParameters):'').get('action')||'';
  if(method==='OPTIONS')return{statusCode:204,body:''};
  if(method==='POST'&&action!=='webhook'){
    const origin=event.headers.origin||event.headers.Origin;
    const host=event.headers.host||event.headers.Host;
    if(origin&&host&&new URL(origin).host!==host)throw new HttpError(403,'Origin haijaruhusiwa.');
  }
  if(action==='config'&&method==='GET')return ok({
    supabase_url:process.env.SUPABASE_URL||'',publishable_key:process.env.SUPABASE_PUBLISHABLE_KEY||''
  });
  if(action==='site'&&method==='GET'){
    const [settings,books]=await Promise.all([
      one('ebook_site_settings','id=eq.1'),
      rows('ebook_books','select=*&status=eq.published&order=created_at.asc')
    ]);
    const featured=books.find(b=>b.featured)||books[0]||null;
    return ok({settings:{...settings,logo_url:assetUrl(settings?.logo_path),
      favicon_url:assetUrl(settings?.favicon_path)},
      featured:featured?publishBook(featured):null,books:books.map(publishBook)});
  }
  if(action==='checkout'&&method==='POST'){
    const b=json(event),bookId=uuid(b.bookId),checkoutId=uuid(b.checkoutId);
    const name=clean(b.name,120),email=clean(b.email,160).toLowerCase();
    let phone=clean(b.phone,25).replace(/[\s+\-()]/g,'');
    if(phone.startsWith('0'))phone='255'+phone.slice(1);
    if(!/^255\d{9}$/.test(phone)||!/^\S+@\S+\.\S+$/.test(email)||name.length<2||typeof b.clientSecret!=='string'||!/^[0-9a-f]{64}$/.test(b.clientSecret))
      throw new HttpError(400,'Jaza jina, email na namba sahihi ya simu.');
    if(!process.env.SNIPPE_API_KEY||!process.env.SNIPPE_WEBHOOK_SECRET||!process.env.SITE_URL)
      throw new HttpError(503,'Malipo bado hayajaunganishwa. Wasiliana na msimamizi.');
    const book=await one('ebook_books',eq('id',bookId));
    if(!book||book.status!=='published'||!book.pdf_path)
      throw new HttpError(409,'Kitabu bado hakijawa tayari kwa mauzo.');
    let order=await one('ebook_orders',eq('checkout_id',checkoutId));
    if(order){
      if(order.checkout_secret_hash!==sha(b.clientSecret)||order.book_id!==bookId||
        order.customer_email!==email||order.customer_phone!==phone)throw new HttpError(409,'Checkout ID imetumika.');
    } else {
      try{
        const found=await insert('ebook_orders',{checkout_id:checkoutId,checkout_secret_hash:sha(b.clientSecret),
          book_id:bookId,customer_name:name,customer_email:email,customer_phone:phone,amount_tzs:book.price_tzs});
        order=found[0];
      }catch(error){
        order=await one('ebook_orders',eq('checkout_id',checkoutId));
        if(!order||order.checkout_secret_hash!==sha(b.clientSecret))throw error;
      }
    }
    const existing=await one('ebook_payments',eq('order_id',order.id));
    if(existing)return ok({orderId:order.id,status:order.status,amount_tzs:order.amount_tzs});
    const words=name.split(/\s+/);
    const result=await snippe('/payments',{method:'POST',
      headers:{'Idempotency-Key':'eb'+order.id.replace(/-/g,'').slice(0,25)},
      body:{payment_type:'mobile',details:{amount:order.amount_tzs,currency:'TZS'},
        phone_number:phone,customer:{firstname:words[0],lastname:words.slice(1).join(' ')||words[0],email},
        webhook_url:process.env.SITE_URL.replace(/\/$/,'')+'/api?action=webhook',
        metadata:{order_id:order.id}}});
    if(!result?.reference)throw new HttpError(502,'Payment reference haijarudi.');
    try{await insert('ebook_payments',{order_id:order.id,provider_reference:result.reference,
      amount_tzs:order.amount_tzs,currency:'TZS',status:'pending'});}
    catch(error){
      const p=await one('ebook_payments',eq('order_id',order.id));
      if(!p||p.provider_reference!==result.reference)throw error;
    }
    return ok({orderId:order.id,status:order.status,amount_tzs:order.amount_tzs},201);
  }
  if(action==='status'&&method==='POST'){
    const b=json(event),order=await one('ebook_orders',eq('id',uuid(b.orderId)));
    if(!order||order.checkout_secret_hash!==sha(String(b.clientSecret||'')))
      throw new HttpError(403,'Access haijaruhusiwa.');
    return ok({status:order.status,amount_tzs:order.amount_tzs});
  }
  if(action==='claim'&&method==='POST'){
    const b=json(event),order=await one('ebook_orders',eq('id',uuid(b.orderId)));
    if(!order||order.checkout_secret_hash!==sha(String(b.clientSecret||''))||order.status!=='paid')
      throw new HttpError(403,'Malipo hayajathibitishwa.');
    return ok({token:await generateAccess(order.id)});
  }
  if(action==='webhook'&&method==='POST'){
    const payload=verifyWebhook(event);
    const data=payload.data||payload;
    const reference=clean(data.reference,200);
    const payment=await one('ebook_payments',eq('provider_reference',reference));
    if(!payment)throw new HttpError(503,'Payment reference not yet stored.');
    if(data.metadata?.order_id&&data.metadata.order_id!==payment.order_id)
      throw new HttpError(409,'Webhook order mismatch');
    const eventId=clean(payload.id||'legacy-'+sha(reference+':'+String(payload.type||payload.event)).slice(0,48),120);
    const verified=await applyPayment(reference,payment.order_id,eventId);
    if(verified==='pending')throw new HttpError(503,'Provider still pending.');
    if(verified==='completed'){
      const order=await one('ebook_orders',eq('id',payment.order_id));
      const sent=await emailAccess(order);
      if(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&!sent)
        throw new HttpError(503,'Email delivery retry required');
    }
    return ok({received:true});
  }
  if(action==='access'&&method==='POST'){
    const b=json(event),token=String(b.token||'');
    if(!/^[0-9a-f]{64}$/.test(token))throw new HttpError(403,'Kiungo si sahihi.');
    const access=await one('ebook_access_tokens',eq('token_hash',sha(token)));
    if(!access||access.revoked_at||Date.parse(access.expires_at)<=Date.now())
      throw new HttpError(403,'Kiungo kimeisha au hakijaruhusiwa.');
    const order=await one('ebook_orders',eq('id',access.order_id));
    if(!order||order.status!=='paid')throw new HttpError(403,'Ununuzi haujathibitishwa.');
    const book=await one('ebook_books',eq('id',order.book_id));
    if(!book?.pdf_path)throw new HttpError(404,'PDF haipo.');
    const isDownload=b.purpose==='download';
    if(b.purpose&&!['download','read'].includes(b.purpose))throw new HttpError(400,'Invalid purpose');
    await insert('ebook_access_events',{order_id:order.id,event_type:isDownload?'download_request':'reader_open'});
    return ok({title:book.title,url:await signFile('ebook-pdfs',book.pdf_path,900),filename:book.slug+'.pdf'});
  }
  if(action.startsWith('admin-')){
    await adminUser(event);
    if(action==='admin-data'&&method==='GET'){
      const [books,settings,orders,payments,events]=await Promise.all([
        rows('ebook_books','select=*&order=created_at.desc'),
        one('ebook_site_settings','id=eq.1'),
        rows('ebook_orders','select=id,book_id,customer_name,customer_email,customer_phone,amount_tzs,status,created_at,paid_at,email_sent_at&order=created_at.desc&limit=100'),
        rows('ebook_payments','select=order_id,provider_reference,status,amount_tzs&order=created_at.desc&limit=100'),
        rows('ebook_access_events','select=order_id,event_type,created_at&order=created_at.desc&limit=100')
      ]);
      return ok({books,settings,orders,payments,events,
        status:{snippe:!!process.env.SNIPPE_API_KEY,webhook:!!process.env.SNIPPE_WEBHOOK_SECRET,
          email:!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM),storage:!!process.env.SUPABASE_SERVICE_ROLE_KEY}});
    }
    const b=method==='POST'?json(event):{};
    if(action==='admin-book'&&method==='POST'){
      const values=Object.fromEntries(bookFields.filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]));
      values.slug=clean(values.slug,100).toLowerCase();
      values.title=clean(values.title,200);
      values.subtitle=clean(values.subtitle,300);
      values.description=clean(values.description,10000);
      values.price_tzs=Number(values.price_tzs);
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)||!values.title||
        !Number.isSafeInteger(values.price_tzs)||values.price_tzs<500||
        !['draft','published'].includes(values.status))
        throw new HttpError(400,'Title, slug, price au status si sahihi.');
      if(values.cover_path&&!/^[-\w/]+\.(png|jpg|jpeg|webp|ico)$/.test(values.cover_path))
        throw new HttpError(400,'Cover path si sahihi.');
      if(values.pdf_path&&!/^[-\w/]+\.pdf$/.test(values.pdf_path))
        throw new HttpError(400,'PDF path si sahihi.');
      const id=b.id?uuid(b.id):crypto.randomUUID();
      if(values.featured){
        await patch('ebook_books','featured=eq.true',{featured:false});
      }
      values.updated_at=new Date().toISOString();
      const result=b.id?await patch('ebook_books',eq('id',id),values):
        await insert('ebook_books',{id,...values});
      if(!result?.length)throw new HttpError(404,'Kitabu hakijapatikana.');
      return ok({book:result[0]});
    }
    if(action==='admin-delete'&&method==='POST'){
      const id=uuid(b.id);
      const sold=await one('ebook_orders',eq('book_id',id),'id');
      if(sold)throw new HttpError(409,'Kitabu kina historia ya mauzo. Tumia Unpublish.');
      const deleted=await remove('ebook_books',eq('id',id));
      return ok({deleted:!!deleted?.length});
    }
    if(action==='admin-site'&&method==='POST'){
      const v=Object.fromEntries(siteFields.filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]));
      if(!/^#[0-9a-fA-F]{6}$/.test(v.primary_color)||!/^#[0-9a-fA-F]{6}$/.test(v.text_color)
        ||!['serif','system'].includes(v.font_style))throw new HttpError(400,'Colors au font si sahihi.');
      for(const k of ['site_name','buy_label'])v[k]=clean(v[k],100);
      for(const k of ['about_book','about_author','contents','contact'])v[k]=clean(v[k],12000);
      for(const k of ['logo_path','favicon_path'])
        if(v[k]&&!/^[-\w/]+\.(png|jpg|jpeg|webp|ico)$/.test(v[k]))
          throw new HttpError(400,'Image path si sahihi.');
      v.published_at=new Date().toISOString();
      const result=await patch('ebook_site_settings','id=eq.1',v);
      return ok({settings:result[0]});
    }
    if(action==='admin-upload'&&method==='POST'){
      const kind=clean(b.kind,20),mime=clean(b.mime,50),bookId=b.bookId?uuid(b.bookId):null;
      const kinds={pdf:{bucket:'ebook-pdfs',mimes:['application/pdf'],max:52428800,ext:'pdf'},
        cover:{bucket:'ebook-assets',mimes:['image/jpeg','image/png','image/webp'],max:10485760},
        logo:{bucket:'ebook-assets',mimes:['image/jpeg','image/png','image/webp'],max:10485760},
        favicon:{bucket:'ebook-assets',mimes:['image/png','image/x-icon'],max:1048576}};
      const type=kinds[kind];
      if(!type||!type.mimes.includes(mime)||!Number.isSafeInteger(b.size)||b.size>type.max||b.size<1)
        throw new HttpError(400,'Aina au ukubwa wa faili si sahihi.');
      if(['pdf','cover'].includes(kind)&&(!bookId||!await one('ebook_books',eq('id',bookId))))
        throw new HttpError(400,'Hifadhi kitabu kwanza kabla ya kupakia faili.');
      const ext=type.ext||({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/x-icon':'ico'})[mime];
      const path=(bookId||'branding')+'/'+crypto.randomUUID()+'.'+ext;
      const response=await supa('/storage/v1/object/upload/sign/'+type.bucket+'/'+path,{method:'POST',body:{}});
      const signed= response?.url?new URL('/storage/v1'+response.url,process.env.SUPABASE_URL).href:null;
      if(!signed)throw new HttpError(502,'Imeshindikana kuandaa upload.');
      return ok({path,url:signed,kind});
    }
    if(action==='admin-verify'&&method==='POST'){
      const p=await one('ebook_payments',eq('order_id',uuid(b.orderId)));
      if(!p)throw new HttpError(404,'Payment haipo.');
      const status=await applyPayment(p.provider_reference,p.order_id,'admin-'+crypto.randomUUID());
      if(status==='completed'){
        const order=await one('ebook_orders',eq('id',p.order_id));
        await emailAccess(order);
      }
      return ok({status});
    }
    if(action==='admin-resend'&&method==='POST'){
      const order=await one('ebook_orders',eq('id',uuid(b.orderId)));
      if(!order||order.status!=='paid')throw new HttpError(409,'Malipo hayajathibitishwa.');
      const sent=await emailAccess(order,true);
      if(!sent)throw new HttpError(503,'Weka RESEND_API_KEY, EMAIL_FROM na SITE_URL.');
      return ok({sent:true});
    }
  }
  throw new HttpError(404,'Endpoint haipo.');
}
export const handler=async event=>{
  try{return await handle(event);}
  catch(e){
    if(!(e instanceof HttpError))console.error('Unhandled API exception',e?.message||e);
    return fail(e instanceof HttpError?e.status:500,e instanceof HttpError?e.message:'Tatizo la server. Jaribu tena.');
  }
};
