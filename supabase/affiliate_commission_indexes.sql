-- Cover the new affiliate foreign keys for joins and cleanup operations.
begin;
create index if not exists akili_affiliates_approved_by on public.akili_affiliates(approved_by);
create index if not exists akili_campaigns_product on public.akili_affiliate_campaigns(product_id);
create index if not exists akili_campaigns_created_by on public.akili_affiliate_campaigns(created_by);
create index if not exists akili_affiliate_clicks_campaign on public.akili_affiliate_clicks(campaign_id);
create index if not exists akili_affiliate_clicks_product on public.akili_affiliate_clicks(product_id);
create index if not exists akili_affiliate_rules_created_by on public.akili_affiliate_product_rules(created_by);
create index if not exists akili_ledger_campaign on public.akili_ledger(campaign_id);
create index if not exists akili_order_attributions_campaign on public.akili_order_attributions(campaign_id);
create index if not exists akili_order_attributions_product on public.akili_order_attributions(product_id);
commit;