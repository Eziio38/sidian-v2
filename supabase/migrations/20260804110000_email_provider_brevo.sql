-- Brevo comme vendor d'envoi transactionnel
--
-- `email_outbox.provider_kind` n'acceptait que 'resend' et 'stub'. Le produit
-- passe par Brevo : sans cette valeur, toute écriture d'un envoi Brevo
-- violerait la contrainte et le drain échouerait à la première tentative.
--
-- La colonne reste un `text` contraint plutôt qu'un enum : la liste des
-- vendors bouge plus vite qu'un type PostgreSQL, et un enum imposerait une
-- migration bloquante à chaque changement.

alter table public.email_outbox
  drop constraint if exists email_outbox_provider_kind_ck;

alter table public.email_outbox
  add constraint email_outbox_provider_kind_ck
  check (provider_kind in ('brevo', 'resend', 'stub'));

-- Le défaut suit le vendor réellement utilisé.
alter table public.email_outbox
  alter column provider_kind set default 'brevo';

comment on column public.email_outbox.provider_kind is
  'Vendor d''envoi retenu pour cette ligne. Contraint côté SQL et miroir de EMAIL_PROVIDER_KINDS côté TypeScript.';
