-- Inventaire RLS cumulatif : conserve les tables Stripe déjà contrôlées et
-- ajoute conversation_project sans réduire la couverture existante.

create or replace function public.sidian_assert_rls_enabled()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'prestataire',
      'client_payeur',
      'creance',
      'tentative_paiement',
      'paiement',
      'payment_authorization',
      'dossier_suivi',
      'regle',
      'conversation',
      'conversation_project',
      'message',
      'approval_request',
      'audit_log',
      'processed_webhook_event',
      'stripe_customer_binding',
      'payment_link',
      'stripe_webhook_effect',
      'stripe_connect_audit_outbox',
      'public_rate_limit_event'
    )
  order by c.relname;
$$;

revoke all on function public.sidian_assert_rls_enabled() from public;
grant execute on function public.sidian_assert_rls_enabled() to service_role;
