-- Sidian V2 — privilèges SQL (moindre privilège)

revoke all on table public.prestataire from anon;
revoke all on table public.client_payeur from anon;
revoke all on table public.creance from anon;
revoke all on table public.tentative_paiement from anon;
revoke all on table public.paiement from anon;
revoke all on table public.payment_authorization from anon;
revoke all on table public.dossier_suivi from anon;
revoke all on table public.regle from anon;
revoke all on table public.conversation from anon;
revoke all on table public.message from anon;
revoke all on table public.approval_request from anon;
revoke all on table public.audit_log from anon;
revoke all on table public.processed_webhook_event from anon;

grant select, insert, update, delete on table public.prestataire to authenticated;
grant select, insert, update, delete on table public.client_payeur to authenticated;
grant select, insert, update, delete on table public.creance to authenticated;
grant select on table public.tentative_paiement to authenticated;
grant select on table public.paiement to authenticated;
grant select on table public.payment_authorization to authenticated;
grant select, insert, update on table public.dossier_suivi to authenticated;
grant select, insert, update, delete on table public.regle to authenticated;
grant select, insert, update on table public.conversation to authenticated;
grant select, insert on table public.message to authenticated;
grant select, insert, update on table public.approval_request to authenticated;
grant select, insert on table public.audit_log to authenticated;

grant all on table public.prestataire to service_role;
grant all on table public.client_payeur to service_role;
grant all on table public.creance to service_role;
grant all on table public.tentative_paiement to service_role;
grant all on table public.paiement to service_role;
grant all on table public.payment_authorization to service_role;
grant all on table public.dossier_suivi to service_role;
grant all on table public.regle to service_role;
grant all on table public.conversation to service_role;
grant all on table public.message to service_role;
grant all on table public.approval_request to service_role;
grant all on table public.audit_log to service_role;
grant all on table public.processed_webhook_event to service_role;

grant usage on schema public to anon, authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
