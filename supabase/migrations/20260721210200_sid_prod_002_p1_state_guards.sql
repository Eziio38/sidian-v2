-- SID-PROD-002 — garde-fous P1 sur archivage et clôture relationnelle.
--
-- Migration additive : les migrations 20260721210000 et 20260721210100 ont
-- déjà été appliquées et ne sont pas modifiées. Les commandes continuent de
-- prendre la créance tenant-scopée comme premier verrou.

-- Une créance financièrement terminale ne peut plus faire progresser son
-- dossier relationnel. CLOS reste rejouable pour préserver l'idempotence.
create or replace function public.is_dossier_suivi_transition_allowed(
  p_from public.dossier_suivi_etat,
  p_to public.dossier_suivi_etat,
  p_creance_etat public.creance_etat
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_from is null or p_to is null or p_creance_etat is null then false
    -- Architecture V2 §2.1 et §2.4 : une créance terminale n'autorise plus
    -- qu'une clôture du domaine relationnel (ou son replay CLOS -> CLOS).
    when p_creance_etat in ('REGLEE', 'ANNULEE', 'IRRECOUVRABLE') then
      p_to = 'CLOS'
    when p_from = p_to then true
    -- CLOS est terminal pour le dossier.
    when p_from = 'CLOS' then false
    when p_to = 'CLOS' then p_from = 'ESCALADE_HUMAINE'
    when p_from = 'PREVENTION' then
      p_to in (
        'ECHEANCE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ECHEANCE' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'SUIVI_AMIABLE' then
      p_to in (
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'PAUSE_LITIGE' then
      p_to in (
        'SUIVI_AMIABLE',
        'ATTENTE_CLIENT',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ATTENTE_CLIENT' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_PRESTATAIRE',
        'ESCALADE_HUMAINE'
      )
    when p_from = 'ATTENTE_PRESTATAIRE' then
      p_to in (
        'SUIVI_AMIABLE',
        'PAUSE_LITIGE',
        'ATTENTE_CLIENT',
        'ESCALADE_HUMAINE'
      )
    else false
  end;
$$;

comment on function public.is_dossier_suivi_transition_allowed(
  public.dossier_suivi_etat,
  public.dossier_suivi_etat,
  public.creance_etat
) is
  'SID-PROD-002 — matrice interne des transitions relationnelles. Une créance financièrement terminale impose CLOS ; CLOS reste rejouable et terminal.';

revoke all on function public.is_dossier_suivi_transition_allowed(
  public.dossier_suivi_etat,
  public.dossier_suivi_etat,
  public.creance_etat
) from public, anon, authenticated, service_role;

-- L'archivage est une opération de rangement, pas une transition financière.
-- Les états actifs passent obligatoirement par leur commande métier :
-- cancel_current_payment_receivable pour OUVERTE / EN_LITIGE. Une créance
-- partiellement réglée ne peut jamais être masquée par archivage.
create or replace function public.archive_current_creance(p_id uuid)
returns public.creance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prestataire_id uuid := public.require_current_prestataire_id();
  v_row public.creance;
  v_now timestamptz;
begin
  if p_id is null then
    raise exception 'creance_not_found'
      using errcode = 'P0002';
  end if;

  -- Premier et unique verrou : même ordre creance-first que les commandes
  -- financières et relationnelles SID-PROD-002.
  select cr.*
    into v_row
  from public.creance as cr
  where cr.id = p_id
    and cr.prestataire_id = v_prestataire_id
  for update;

  if not found then
    raise exception 'creance_not_found'
      using errcode = 'P0002';
  end if;

  -- Replay pur : aucune nouvelle écriture ni réinterprétation de l'état.
  if v_row.archived_at is not null then
    return v_row;
  end if;

  if v_row.etat not in ('BROUILLON', 'REGLEE', 'ANNULEE', 'IRRECOUVRABLE') then
    raise exception 'payment_receivable_must_be_cancelled_before_archive'
      using errcode = '23514';
  end if;

  v_now := clock_timestamp();

  update public.creance as cr
  set
    archived_at = v_now,
    updated_at = v_now
  where cr.id = v_row.id
    and cr.prestataire_id = v_prestataire_id
    and cr.archived_at is null
  returning cr.* into v_row;

  if not found then
    raise exception 'creance_not_found'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.archive_current_creance(uuid) is
  'SID-PROD-002 — archive idempotemment un BROUILLON ou un paiement à recevoir financièrement terminal. Les états actifs doivent utiliser leur commande métier dédiée.';

revoke all on function public.archive_current_creance(uuid)
  from public, anon, service_role;
grant execute on function public.archive_current_creance(uuid)
  to authenticated;
