-- Reviewed against the actual nine-page book. Price, files and ownership are unchanged.
begin;
do $$
declare b public.ebook_books; old_contents text;
begin
 select * into b from public.ebook_books where slug='mifumo-7-muhimu' and status='published' for update;
 if b.id is null or b.page_count<>9 then raise exception 'Published nine-page source book required'; end if;
 insert into public.akili_product_versions(book_id,actor_id,snapshot) values(b.id,b.author_id,to_jsonb(b));
 select contents into old_contents from public.ebook_site_settings where id=1;
 update public.ebook_books set description=$description$Biashara yako inategemea wewe kufanya kila kitu? Mwongozo huu unaeleza namna ya kupanga biashara kupitia mifumo saba: usimamizi wa kimkakati, masoko, mauzo, uendeshaji, utawala, mtiririko wa fedha na rasilimali watu.

Jifunze tofauti kati ya mkakati, mfumo, mchakato na utaratibu, pamoja na hatua za kuanza kuandika namna kazi zinavyofanyika. PDF ya kurasa 9 kwa Kiswahili. Soma sampuli kabla ya kununua.$description$,updated_at=now() where id=b.id;
 if (select count(*) from public.ebook_books where status='published')=1 then
  update public.ebook_site_settings set contents=$contents$1. Usimamizi wa kimkakati
2. Masoko
3. Mauzo
4. Uendeshaji
5. Utawala
6. Mtiririko wa fedha
7. Rasilimali watu$contents$ where id=1;
 end if;
 insert into public.akili_audit_logs(actor_id,action,target_id,details) values(b.author_id,'book.marketing_copy_updated',b.id::text,jsonb_build_object('source','akili-store-mifumo-7.pdf','old_contents',old_contents,'fields',jsonb_build_array('description','contents')));
end $$;
commit;
select slug,price_tzs,page_count from public.ebook_books where slug='mifumo-7-muhimu';
