-- Sidian V2 — tables principales et contraintes

-- Prestataire : un opérateur unique par compte auth au MVP
create table public.prestataire (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete restrict,
  nom text not null,
  email text not null,
  subscription_status public.subscription_status not null default 'trialing',
  pricing_version text not null default 'early_access_49',
  subscription_started_at timestamptz,
  early_access_price_locked_until timestamptz,
  profil_agent_defaut public.profil_agent_defaut not null default 'controle',
  platform_fee_basis_points integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint prestataire_platform_fee_basis_points_nonneg
    check (platform_fee_basis_points >= 0)
);

comment on table public.prestataire is
  'Organisation mandante — un seul utilisateur auth au MVP, sans RBAC.';
comment on column public.prestataire.platform_fee_basis_points is
  'Commission plateforme en points de base — 0 pendant l''Early Access.';

create table public.client_payeur (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  nom text not null,
  email text not null,
  historique_paiements_reguliers integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint client_payeur_historique_nonneg
    check (historique_paiements_reguliers >= 0)
);

comment on table public.client_payeur is
  'Client payeur rattaché à un prestataire — aucune FK vers une autorisation active.';

create table public.creance (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  client_payeur_id uuid not null references public.client_payeur (id) on delete restrict,
  montant bigint not null,
  devise char(3) not null default 'EUR',
  origine public.creance_origine not null,
  reference_externe text,
  date_echeance date not null,
  etat public.creance_etat not null default 'BROUILLON',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint creance_montant_positif check (montant > 0),
  constraint creance_devise_format check (char_length(devise) = 3)
);

comment on table public.creance is
  'Entité pivot interne — visible produit sous « paiement à recevoir ».';
comment on column public.creance.etat is
  'État financier uniquement — indépendant des tentatives et du dossier de suivi.';

create table public.tentative_paiement (
  id uuid primary key default gen_random_uuid(),
  creance_id uuid not null references public.creance (id) on delete restrict,
  montant bigint not null,
  moyen public.tentative_paiement_moyen not null,
  source public.tentative_paiement_source not null,
  stripe_payment_intent_id text,
  etat public.tentative_paiement_etat not null default 'CREEE',
  echec_code text,
  echec_message text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tentative_paiement_montant_positif check (montant > 0)
);

comment on table public.tentative_paiement is
  'Un essai de paiement, y compris échoué — jamais une ligne dans paiement.';

create table public.paiement (
  id uuid primary key default gen_random_uuid(),
  creance_id uuid not null references public.creance (id) on delete restrict,
  tentative_paiement_id uuid references public.tentative_paiement (id) on delete restrict,
  montant bigint not null,
  source public.paiement_source not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint paiement_montant_positif check (montant > 0)
);

comment on table public.paiement is
  'Règlements confirmés uniquement — le solde est la somme des montants.';

create table public.payment_authorization (
  id uuid primary key default gen_random_uuid(),
  client_payeur_id uuid not null references public.client_payeur (id) on delete restrict,
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  type public.payment_authorization_type not null,
  stripe_payment_method_id text not null,
  stripe_mandate_id text,
  etat public.payment_authorization_etat not null default 'NON_PROPOSEE',
  is_default boolean not null default false,
  authorized_at timestamptz,
  authorization_text_version text,
  authorization_channel text,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint payment_authorization_scope_client_prestataire
    check (client_payeur_id is not null and prestataire_id is not null)
);

comment on table public.payment_authorization is
  'Autorisation scopée client_payeur × prestataire — jamais globale.';

create table public.dossier_suivi (
  id uuid primary key default gen_random_uuid(),
  creance_id uuid not null unique references public.creance (id) on delete cascade,
  etat public.dossier_suivi_etat not null default 'PREVENTION',
  last_client_activity_at timestamptz,
  last_agent_action_at timestamptz,
  next_action_at timestamptz,
  escalation_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  clos_at timestamptz
);

comment on table public.dossier_suivi is
  'Fil relationnel — état indépendant de creance.etat.';

create table public.regle (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  client_payeur_id uuid references public.client_payeur (id) on delete cascade,
  parametre public.regle_parametre not null,
  valeur jsonb not null,
  origine public.regle_origine not null default 'defaut',
  libelle_instruction_origine text,
  actif boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.conversation (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  creance_id uuid references public.creance (id) on delete set null,
  client_payeur_id uuid references public.client_payeur (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversation (id) on delete cascade,
  emetteur public.message_emetteur not null,
  contenu text not null,
  canal public.message_canal not null,
  actor_type public.actor_type not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint message_contenu_non_vide check (char_length(trim(contenu)) > 0)
);

comment on table public.message is
  'Journal append-only — aucune modification ni suppression via droits ordinaires.';

create table public.approval_request (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  creance_id uuid references public.creance (id) on delete set null,
  type public.approval_request_type not null,
  requested_by_actor_type public.actor_type not null,
  requested_by_provider text,
  payload jsonb not null default '{}'::jsonb,
  status public.approval_request_status not null default 'pending',
  approved_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  constraint approval_request_no_self_approval
    check (
      status <> 'approved'
      or approved_by is not null
    )
);

comment on table public.approval_request is
  'Demande d''approbation registre encadré — l''agent ne peut pas s''auto-approuver.';

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null references public.prestataire (id) on delete restrict,
  actor_type public.actor_type not null,
  actor_provider text,
  actor_model text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.audit_log is
  'Trace append-only des actions du registre encadré.';

create table public.processed_webhook_event (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default timezone('utc', now())
);

comment on table public.processed_webhook_event is
  'Déduplication technique des webhooks Stripe — id = event_id Stripe.';

-- Cohérence tenant : client_payeur et creance doivent appartenir au même prestataire
create or replace function public.enforce_client_payeur_prestataire_match()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  select cp.prestataire_id into v_prestataire_id
  from public.client_payeur cp
  where cp.id = new.client_payeur_id;

  if v_prestataire_id is null then
    raise exception 'client_payeur introuvable';
  end if;

  if new.prestataire_id is distinct from v_prestataire_id then
    raise exception 'client_payeur et prestataire incohérents';
  end if;

  return new;
end;
$$;

create trigger creance_client_prestataire_match
before insert or update on public.creance
for each row execute function public.enforce_client_payeur_prestataire_match();

create or replace function public.enforce_payment_authorization_scope()
returns trigger
language plpgsql
as $$
declare
  v_prestataire_id uuid;
begin
  select cp.prestataire_id into v_prestataire_id
  from public.client_payeur cp
  where cp.id = new.client_payeur_id;

  if v_prestataire_id is distinct from new.prestataire_id then
    raise exception 'payment_authorization : scope client × prestataire invalide';
  end if;

  return new;
end;
$$;

create trigger payment_authorization_scope_check
before insert or update on public.payment_authorization
for each row execute function public.enforce_payment_authorization_scope();

-- Prestataire courant pour RLS
create or replace function public.current_prestataire_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.prestataire p
  where p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_prestataire_id() from public;
grant execute on function public.current_prestataire_id() to authenticated, service_role;
