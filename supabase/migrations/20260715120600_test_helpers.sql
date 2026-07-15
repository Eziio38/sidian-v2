-- Fonctions de test structurel (service_role uniquement)

create or replace function public.sidian_assert_rls_enabled()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
set search_path = public
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
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
      'message',
      'approval_request',
      'audit_log',
      'processed_webhook_event'
    )
  order by c.relname;
$$;

revoke all on function public.sidian_assert_rls_enabled() from public;
grant execute on function public.sidian_assert_rls_enabled() to service_role;
