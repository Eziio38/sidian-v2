-- Sidian V2 — index

-- FK fréquentes
create index client_payeur_prestataire_id_idx
  on public.client_payeur (prestataire_id);

create index creance_prestataire_id_idx
  on public.creance (prestataire_id);

create index creance_client_payeur_id_idx
  on public.creance (client_payeur_id);

create index tentative_paiement_creance_id_idx
  on public.tentative_paiement (creance_id);

create index paiement_creance_id_idx
  on public.paiement (creance_id);

create index paiement_tentative_paiement_id_idx
  on public.paiement (tentative_paiement_id)
  where tentative_paiement_id is not null;

create index payment_authorization_prestataire_id_idx
  on public.payment_authorization (prestataire_id);

create index payment_authorization_client_payeur_id_idx
  on public.payment_authorization (client_payeur_id);

create index regle_prestataire_id_idx
  on public.regle (prestataire_id);

create index regle_client_payeur_id_idx
  on public.regle (client_payeur_id)
  where client_payeur_id is not null;

create index conversation_prestataire_id_idx
  on public.conversation (prestataire_id);

create index conversation_creance_id_idx
  on public.conversation (creance_id)
  where creance_id is not null;

create index approval_request_prestataire_id_idx
  on public.approval_request (prestataire_id);

create index audit_log_prestataire_id_idx
  on public.audit_log (prestataire_id);

-- Requêtes métier et workers
create index creance_prestataire_etat_idx
  on public.creance (prestataire_id, etat);

create index creance_client_date_echeance_idx
  on public.creance (client_payeur_id, date_echeance);

create index creance_date_echeance_idx
  on public.creance (date_echeance);

create index tentative_paiement_creance_created_at_idx
  on public.tentative_paiement (creance_id, created_at desc);

create unique index tentative_paiement_stripe_payment_intent_id_unique_idx
  on public.tentative_paiement (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index paiement_creance_created_at_idx
  on public.paiement (creance_id, created_at desc);

create unique index paiement_tentative_paiement_id_unique_idx
  on public.paiement (tentative_paiement_id)
  where tentative_paiement_id is not null;

create index payment_authorization_scope_etat_idx
  on public.payment_authorization (prestataire_id, client_payeur_id, etat);

create unique index payment_authorization_default_unique_idx
  on public.payment_authorization (client_payeur_id, prestataire_id)
  where is_default = true;

create index message_conversation_created_at_idx
  on public.message (conversation_id, created_at);

create index approval_request_prestataire_status_idx
  on public.approval_request (prestataire_id, status);

create index processed_webhook_event_processed_at_idx
  on public.processed_webhook_event (processed_at desc);
