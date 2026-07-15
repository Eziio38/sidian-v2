-- Sidian V2 — extensions, enums et fonctions utilitaires

create extension if not exists pgcrypto with schema extensions;

-- Statut d'abonnement prestataire
create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'cancelled'
);

-- Profil agent par défaut
create type public.profil_agent_defaut as enum (
  'controle',
  'delegation'
);

-- Machine d'état financière de la créance (indépendante des autres domaines)
create type public.creance_etat as enum (
  'BROUILLON',
  'OUVERTE',
  'PARTIELLEMENT_REGLEE',
  'REGLEE',
  'EN_LITIGE',
  'ANNULEE',
  'IRRECOUVRABLE'
);

create type public.creance_origine as enum (
  'facture_externe',
  'acompte',
  'echeancier',
  'abonnement',
  'import_manuel'
);

-- Machine d'état d'une tentative de paiement
create type public.tentative_paiement_etat as enum (
  'CREEE',
  'NECESSITE_ACTION_CLIENT',
  'EN_TRAITEMENT',
  'REUSSIE',
  'ECHOUEE',
  'ANNULEE'
);

create type public.tentative_paiement_moyen as enum (
  'carte',
  'sepa_core'
);

create type public.tentative_paiement_source as enum (
  'lien_agent',
  'prelevement_auto'
);

-- Règlements confirmés uniquement
create type public.paiement_source as enum (
  'lien_agent',
  'prelevement_auto',
  'detecte_hors_sidian'
);

-- Machine d'état d'autorisation de paiement
create type public.payment_authorization_type as enum (
  'card_off_session',
  'sepa_core_mandate'
);

create type public.payment_authorization_etat as enum (
  'NON_PROPOSEE',
  'PROPOSEE',
  'EN_CONFIGURATION',
  'ACTIVE',
  'REFUSEE',
  'SUSPENDUE',
  'REVOQUEE',
  'EXPIREE'
);

-- Machine d'état relationnelle du dossier de suivi
create type public.dossier_suivi_etat as enum (
  'PREVENTION',
  'ECHEANCE',
  'SUIVI_AMIABLE',
  'PAUSE_LITIGE',
  'ATTENTE_CLIENT',
  'ATTENTE_PRESTATAIRE',
  'ESCALADE_HUMAINE',
  'CLOS'
);

-- Règles configurables
create type public.regle_origine as enum (
  'defaut',
  'instruction_naturelle'
);

create type public.regle_parametre as enum (
  'delai_grace',
  'montant_max_etalement',
  'nb_demandes_avant_escalade',
  'seuil_validation_humaine',
  'vitesse_escalade_ton',
  'plafond_fermete',
  'canaux_autorises',
  'frequence_max_sollicitation',
  'horaires_autorises'
);

-- Communication
create type public.message_emetteur as enum (
  'agent',
  'prestataire',
  'client'
);

create type public.message_canal as enum (
  'email',
  'interface'
);

create type public.actor_type as enum (
  'human',
  'sidian_agent',
  'system',
  'external_integration'
);

-- Approbations registre encadré
create type public.approval_request_type as enum (
  'formal_action',
  'rule_change',
  'depassement_seuil',
  'autre'
);

create type public.approval_request_status as enum (
  'pending',
  'approved',
  'rejected',
  'expired'
);

comment on type public.creance_etat is
  'État financier de la créance — indépendant des tentatives, autorisations et dossier de suivi.';

comment on type public.tentative_paiement_etat is
  'État d''un essai de paiement — une échec ne modifie jamais automatiquement creance.etat.';

-- Horodatage updated_at générique
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
