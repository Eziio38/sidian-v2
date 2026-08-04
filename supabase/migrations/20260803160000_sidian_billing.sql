-- SID-BILLING-001 — abonnement Sidian (49 € HT/mois, cf. 02 §6).
--
-- Problème résolu : `prestataire.subscription_status` n'avait AUCUN chemin
-- d'écriture. Tous les comptes restaient 'trialing' à vie ; personne ne pouvait
-- être facturé ni restreint.
--
-- Principes de cette migration :
--   1. Le seul auteur du cycle de vie de l'abonnement est Stripe, via webhook
--      signé. Aucune action utilisateur n'écrit `subscription_status`.
--   2. Séparation stricte d'avec Connect : cette table décrit l'abonnement du
--      prestataire AU compte plateforme Sidian, jamais un compte connecté.
--      `stripe_customer_binding` (Connect) reste le binding client-payeur ; les
--      deux ne se croisent jamais.
--   3. Idempotence : réutilisation du registre existant
--      `public.stripe_webhook_effect` — aucun mécanisme parallèle.
--   4. Ordonnancement : Stripe ne garantit pas l'ordre de livraison. Un
--      événement de cycle de vie plus ancien que le dernier appliqué est ignoré.

-- ---------------------------------------------------------------------------
-- 1. Binding prestataire ↔ abonnement Stripe (compte PLATEFORME)
-- ---------------------------------------------------------------------------

create table public.sidian_subscription (
  prestataire_id uuid primary key
    references public.prestataire (id) on delete restrict,
  -- Customer du compte plateforme Sidian. Distinct des Customers Connect créés
  -- dans les comptes connectés (public.stripe_customer_binding).
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  -- Statut brut Stripe conservé tel quel (incomplete, incomplete_expired,
  -- trialing, active, past_due, canceled, unpaid, paused). La projection vers
  -- public.subscription_status est faite par map_stripe_subscription_status.
  stripe_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Horodatage Stripe du dernier événement de CYCLE DE VIE appliqué.
  -- invoice.payment_failed n'y touche pas : il ne doit jamais faire écran à un
  -- customer.subscription.updated qui, lui, fait autorité.
  last_subscription_event_at timestamptz,
  last_subscription_event_id text,
  last_payment_failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sidian_subscription_customer_not_blank
    check (nullif(btrim(stripe_customer_id), '') is not null),
  constraint sidian_subscription_subscription_not_blank
    check (stripe_subscription_id is null
      or nullif(btrim(stripe_subscription_id), '') is not null)
);

comment on table public.sidian_subscription is
  'Abonnement Sidian du prestataire sur le compte plateforme. Écrit uniquement par les webhooks de facturation (service_role). Sans rapport avec Stripe Connect.';

comment on column public.sidian_subscription.last_subscription_event_at is
  'Garde-fou d''ordonnancement : un événement de cycle de vie antérieur est ignoré.';

create index sidian_subscription_stripe_subscription_idx
  on public.sidian_subscription (stripe_subscription_id)
  where stripe_subscription_id is not null;

create trigger sidian_subscription_set_updated_at
before update on public.sidian_subscription
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — lecture propriétaire, aucune écriture navigateur
-- ---------------------------------------------------------------------------

alter table public.sidian_subscription enable row level security;

revoke all privileges on table public.sidian_subscription from public, anon, authenticated;

-- Lecture seule : l'UI doit pouvoir afficher l'état réel de l'abonnement.
-- Aucun INSERT / UPDATE / DELETE n'est accordé à authenticated : l'absence de
-- privilège rend toute policy d'écriture inutile.
grant select on table public.sidian_subscription to authenticated;
grant all on table public.sidian_subscription to service_role;

create policy sidian_subscription_select_scope
  on public.sidian_subscription
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- ---------------------------------------------------------------------------
-- 3. Projection statut Stripe → public.subscription_status
-- ---------------------------------------------------------------------------
--
-- L'énumération produit ne compte que 4 valeurs. Choix de projection, tous
-- documentés ici pour qu'aucune règle ne soit implicite :
--   trialing            → trialing   (période d'essai Stripe)
--   active              → active
--   past_due            → past_due
--   unpaid              → past_due   (Stripe a cessé de relancer mais
--                                     l'abonnement existe encore ; seul
--                                     customer.subscription.deleted clôture)
--   paused              → past_due   (collecte suspendue, pas résiliée)
--   incomplete          → past_due   (premier paiement non abouti : surtout
--                                     PAS 'trialing', qui est permissif)
--   incomplete_expired  → cancelled
--   canceled            → cancelled
-- Toute valeur inconnue → past_due (fail closed sans verrouiller définitivement).

create or replace function public.map_stripe_subscription_status(
  p_stripe_status text
)
returns public.subscription_status
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case lower(coalesce(nullif(btrim(p_stripe_status), ''), ''))
    when 'trialing' then 'trialing'::public.subscription_status
    when 'active' then 'active'::public.subscription_status
    when 'past_due' then 'past_due'::public.subscription_status
    when 'unpaid' then 'past_due'::public.subscription_status
    when 'paused' then 'past_due'::public.subscription_status
    when 'incomplete' then 'past_due'::public.subscription_status
    when 'incomplete_expired' then 'cancelled'::public.subscription_status
    when 'canceled' then 'cancelled'::public.subscription_status
    when 'cancelled' then 'cancelled'::public.subscription_status
    else 'past_due'::public.subscription_status
  end;
$$;

comment on function public.map_stripe_subscription_status(text) is
  'Projection déterministe statut Stripe → public.subscription_status. Statut inconnu → past_due (jamais trialing).';

revoke all on function public.map_stripe_subscription_status(text) from public, anon;
grant execute on function public.map_stripe_subscription_status(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Binding du Customer plateforme (avant Checkout)
-- ---------------------------------------------------------------------------
--
-- Appelée par le serveur avec un prestataire_id DÉJÀ dérivé de la session ;
-- la fonction refuse tout croisement d'identité (un Customer = un prestataire).

create or replace function public.bind_sidian_subscription_customer(
  p_prestataire_id uuid,
  p_stripe_customer_id text
)
returns public.sidian_subscription
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_customer text := nullif(btrim(p_stripe_customer_id), '');
  v_row public.sidian_subscription;
begin
  if p_prestataire_id is null then
    raise exception 'billing_prestataire_required' using errcode = '22023';
  end if;
  if v_customer is null then
    raise exception 'billing_customer_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.prestataire p where p.id = p_prestataire_id) then
    raise exception 'billing_prestataire_not_found' using errcode = 'P0002';
  end if;

  -- Le Customer ne peut pas migrer d'un prestataire à un autre.
  if exists (
    select 1
    from public.sidian_subscription s
    where s.stripe_customer_id = v_customer
      and s.prestataire_id is distinct from p_prestataire_id
  ) then
    raise exception 'billing_customer_bound_elsewhere' using errcode = '42501';
  end if;

  insert into public.sidian_subscription (prestataire_id, stripe_customer_id)
  values (p_prestataire_id, v_customer)
  on conflict (prestataire_id) do nothing;

  select s.* into v_row
  from public.sidian_subscription s
  where s.prestataire_id = p_prestataire_id;

  -- Un prestataire déjà lié à un autre Customer ne bascule pas silencieusement.
  if v_row.stripe_customer_id is distinct from v_customer then
    raise exception 'billing_customer_binding_conflict' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.bind_sidian_subscription_customer(uuid, text) is
  'Lie le prestataire à son Customer de facturation plateforme. Idempotente, refuse tout croisement d''identité.';

revoke all on function public.bind_sidian_subscription_customer(uuid, text)
  from public, anon, authenticated;
grant execute on function public.bind_sidian_subscription_customer(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Transitions du cycle de vie (webhooks signés uniquement)
-- ---------------------------------------------------------------------------
--
-- p_early_access_lock_months : durée du verrouillage tarifaire Early Access.
--
--   [DÉCISION EN ATTENTE — NON TRANCHÉE ICI]
--   02 §6 annonce « prix maintenu 12 mois » pour les 20 premiers comptes ;
--   03 §1 annonce « verrouillage à vie pour les 30 premiers comptes, pas une
--   fenêtre de 12 mois ». Les deux documents se contredisent. Ce code
--   implémente le MÉCANISME et laisse la valeur en configuration explicite
--   (STRIPE_BILLING_EARLY_ACCESS_LOCK_MONTHS). Non renseignée ⇒ NULL ⇒ aucune
--   promesse tarifaire n'est enregistrée. Aucune durée n'est choisie par défaut.
--
-- pricing_version n'est JAMAIS réécrit ici : 03 §1 interdit toute
-- reclassification automatique vers une offre active.

create or replace function public.apply_sidian_subscription_event(
  p_stripe_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_status text,
  p_stripe_price_id text default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_early_access_lock_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_customer text := nullif(btrim(p_stripe_customer_id), '');
  v_subscription text := nullif(btrim(p_stripe_subscription_id), '');
  v_row public.sidian_subscription;
  v_effect_inserted boolean := false;
  v_effect_type text;
  v_status public.subscription_status;
  v_previous public.subscription_status;
  v_now timestamptz := timezone('utc', now());
  v_lock_until timestamptz;
begin
  if p_event_type not in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ) then
    raise exception 'billing_event_type_unsupported' using errcode = '22023';
  end if;
  if nullif(btrim(p_stripe_event_id), '') is null then
    raise exception 'billing_event_id_required' using errcode = '22023';
  end if;
  if v_customer is null or v_subscription is null then
    raise exception 'billing_event_identity_required' using errcode = '22023';
  end if;
  if p_event_created_at is null then
    raise exception 'billing_event_created_at_required' using errcode = '22023';
  end if;
  if p_early_access_lock_months is not null
    and (p_early_access_lock_months < 1 or p_early_access_lock_months > 600)
  then
    raise exception 'billing_early_access_lock_invalid' using errcode = '22023';
  end if;

  select s.* into v_row
  from public.sidian_subscription s
  where s.stripe_customer_id = v_customer
  for update;

  if not found then
    -- Aucun prestataire lié : on n'invente pas de compte. L'appelant marquera
    -- l'événement « ignored », il ne sera pas rejoué indéfiniment.
    return jsonb_build_object('applied', false, 'reason', 'no_binding_for_customer');
  end if;

  -- Un Customer ne doit pas porter deux abonnements Sidian différents.
  if v_row.stripe_subscription_id is not null
    and v_row.stripe_subscription_id is distinct from v_subscription
  then
    raise exception 'billing_subscription_identity_mismatch' using errcode = '42501';
  end if;

  v_effect_type := 'sidian.subscription.'
    || split_part(p_event_type, '.', 3);

  insert into public.stripe_webhook_effect (
    stripe_event_id,
    stripe_object_id,
    effect_type
  )
  values (p_stripe_event_id, v_subscription, v_effect_type)
  on conflict do nothing;
  v_effect_inserted := found;

  if not v_effect_inserted then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  -- Livraison hors ordre : un événement plus ancien ne réécrit rien.
  if v_row.last_subscription_event_at is not null
    and p_event_created_at < v_row.last_subscription_event_at
  then
    return jsonb_build_object('applied', false, 'reason', 'stale_event');
  end if;

  -- deleted fait foi quel que soit le statut porté par l'objet.
  v_status := case
    when p_event_type = 'customer.subscription.deleted'
      then 'cancelled'::public.subscription_status
    else public.map_stripe_subscription_status(p_stripe_status)
  end;

  select p.subscription_status into v_previous
  from public.prestataire p
  where p.id = v_row.prestataire_id;

  update public.sidian_subscription s
  set
    stripe_subscription_id = v_subscription,
    stripe_price_id = coalesce(nullif(btrim(p_stripe_price_id), ''), s.stripe_price_id),
    stripe_status = case
      when p_event_type = 'customer.subscription.deleted' then 'canceled'
      else lower(nullif(btrim(p_stripe_status), ''))
    end,
    current_period_end = coalesce(p_current_period_end, s.current_period_end),
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
    last_subscription_event_at = p_event_created_at,
    last_subscription_event_id = p_stripe_event_id
  where s.prestataire_id = v_row.prestataire_id
  returning s.* into v_row;

  update public.prestataire p
  set
    subscription_status = v_status,
    -- Premier passage à un abonnement réellement souscrit : on horodate.
    subscription_started_at = case
      when p.subscription_started_at is null and v_status in ('active', 'trialing')
        then v_now
      else p.subscription_started_at
    end,
    early_access_price_locked_until = case
      when p.early_access_price_locked_until is null
        and p_early_access_lock_months is not null
        and v_status in ('active', 'trialing')
        then v_now + make_interval(months => p_early_access_lock_months)
      else p.early_access_price_locked_until
    end
  where p.id = v_row.prestataire_id
  returning p.early_access_price_locked_until into v_lock_until;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    actor_provider,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_row.prestataire_id,
    'system',
    'stripe',
    'billing.subscription.' || split_part(p_event_type, '.', 3),
    'prestataire',
    v_row.prestataire_id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'stripe_subscription_id', v_subscription,
      'stripe_status', v_row.stripe_status,
      'previous_subscription_status', v_previous,
      'subscription_status', v_status,
      'cancel_at_period_end', v_row.cancel_at_period_end
    )
  );

  return jsonb_build_object(
    'applied', true,
    'prestataire_id', v_row.prestataire_id,
    'subscription_status', v_status,
    'previous_subscription_status', v_previous,
    'early_access_price_locked_until', v_lock_until
  );
end;
$$;

comment on function public.apply_sidian_subscription_event(
  text, text, timestamptz, text, text, text, text, timestamptz, boolean, integer
) is
  'Applique une transition d''abonnement Sidian issue d''un webhook signé. Idempotente via stripe_webhook_effect, résistante au hors-ordre, tracée dans audit_log.';

revoke all on function public.apply_sidian_subscription_event(
  text, text, timestamptz, text, text, text, text, timestamptz, boolean, integer
) from public, anon, authenticated;
grant execute on function public.apply_sidian_subscription_event(
  text, text, timestamptz, text, text, text, text, timestamptz, boolean, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Échec de paiement (invoice.payment_failed)
-- ---------------------------------------------------------------------------
--
-- Cet événement N'EST PAS la source de vérité du statut : customer.subscription.updated
-- l'est. Il horodate l'échec et ne dégrade qu'un compte encore actif/en essai,
-- sans jamais toucher last_subscription_event_at (pour ne pas faire écran à
-- l'événement de cycle de vie qui, lui, fait autorité).

create or replace function public.apply_sidian_subscription_payment_failure(
  p_stripe_event_id text,
  p_event_created_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_invoice_id text,
  p_stripe_subscription_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_customer text := nullif(btrim(p_stripe_customer_id), '');
  v_invoice text := nullif(btrim(p_stripe_invoice_id), '');
  v_row public.sidian_subscription;
  v_effect_inserted boolean := false;
  v_previous public.subscription_status;
  v_status public.subscription_status;
begin
  if nullif(btrim(p_stripe_event_id), '') is null then
    raise exception 'billing_event_id_required' using errcode = '22023';
  end if;
  if v_customer is null or v_invoice is null then
    raise exception 'billing_event_identity_required' using errcode = '22023';
  end if;
  if p_event_created_at is null then
    raise exception 'billing_event_created_at_required' using errcode = '22023';
  end if;

  select s.* into v_row
  from public.sidian_subscription s
  where s.stripe_customer_id = v_customer
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no_binding_for_customer');
  end if;

  insert into public.stripe_webhook_effect (
    stripe_event_id,
    stripe_object_id,
    effect_type
  )
  values (p_stripe_event_id, v_invoice, 'sidian.subscription.payment_failed')
  on conflict do nothing;
  v_effect_inserted := found;

  if not v_effect_inserted then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;

  update public.sidian_subscription s
  set last_payment_failed_at = p_event_created_at
  where s.prestataire_id = v_row.prestataire_id
  returning s.* into v_row;

  select p.subscription_status into v_previous
  from public.prestataire p
  where p.id = v_row.prestataire_id;

  -- Dégradation seulement si un événement de cycle de vie plus récent n'a pas
  -- déjà statué, et seulement depuis un état encore ouvert.
  if v_previous in ('active', 'trialing')
    and (
      v_row.last_subscription_event_at is null
      or v_row.last_subscription_event_at <= p_event_created_at
    )
  then
    v_status := 'past_due'::public.subscription_status;
    update public.prestataire p
    set subscription_status = v_status
    where p.id = v_row.prestataire_id;
  else
    v_status := v_previous;
  end if;

  insert into public.audit_log (
    prestataire_id,
    actor_type,
    actor_provider,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_row.prestataire_id,
    'system',
    'stripe',
    'billing.subscription.payment_failed',
    'prestataire',
    v_row.prestataire_id,
    jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'stripe_invoice_id', v_invoice,
      'stripe_subscription_id', nullif(btrim(p_stripe_subscription_id), ''),
      'previous_subscription_status', v_previous,
      'subscription_status', v_status
    )
  );

  return jsonb_build_object(
    'applied', true,
    'prestataire_id', v_row.prestataire_id,
    'previous_subscription_status', v_previous,
    'subscription_status', v_status
  );
end;
$$;

comment on function public.apply_sidian_subscription_payment_failure(
  text, timestamptz, text, text, text
) is
  'Horodate un échec de prélèvement d''abonnement. Ne dégrade qu''un compte actif/en essai ; customer.subscription.updated reste la source de vérité.';

revoke all on function public.apply_sidian_subscription_payment_failure(
  text, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_sidian_subscription_payment_failure(
  text, timestamptz, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Garde-fou — aucune écriture utilisateur du statut d'abonnement
-- ---------------------------------------------------------------------------
--
-- Rappel du modèle existant : protect_prestataire_sensitive_columns (dernière
-- version 20260803120000) refuse déjà toute modification de
-- subscription_status / pricing_version / subscription_started_at /
-- early_access_price_locked_until faite par le rôle `authenticated`. Cette
-- migration n'ajoute aucune colonne à `prestataire`, le trigger reste donc
-- valable tel quel — il est simplement rendu explicite dans les tests SQL
-- (scripts/test-sidian-billing.mjs).
--
-- Ce qu'il fallait ajouter : la même garantie sur la nouvelle table. Elle est
-- obtenue par privilèges (aucun INSERT/UPDATE/DELETE accordé à authenticated),
-- pas seulement par RLS — même sans policy d'écriture, l'absence de privilège
-- est la défense de premier rang.
