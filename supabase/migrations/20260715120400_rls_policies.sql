-- Sidian V2 — RLS

alter table public.prestataire enable row level security;
alter table public.client_payeur enable row level security;
alter table public.creance enable row level security;
alter table public.tentative_paiement enable row level security;
alter table public.paiement enable row level security;
alter table public.payment_authorization enable row level security;
alter table public.dossier_suivi enable row level security;
alter table public.regle enable row level security;
alter table public.conversation enable row level security;
alter table public.message enable row level security;
alter table public.approval_request enable row level security;
alter table public.audit_log enable row level security;
alter table public.processed_webhook_event enable row level security;

-- prestataire
create policy prestataire_select_own
  on public.prestataire
  for select
  to authenticated
  using (user_id = auth.uid());

create policy prestataire_insert_own
  on public.prestataire
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy prestataire_update_own
  on public.prestataire
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- client_payeur
create policy client_payeur_select_scope
  on public.client_payeur
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy client_payeur_insert_scope
  on public.client_payeur
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

create policy client_payeur_update_scope
  on public.client_payeur
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (prestataire_id = public.current_prestataire_id());

create policy client_payeur_delete_scope
  on public.client_payeur
  for delete
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- creance
create policy creance_select_scope
  on public.creance
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy creance_insert_scope
  on public.creance
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

create policy creance_update_scope
  on public.creance
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (prestataire_id = public.current_prestataire_id());

create policy creance_delete_scope
  on public.creance
  for delete
  to authenticated
  using (
    prestataire_id = public.current_prestataire_id()
    and etat = 'BROUILLON'
  );

-- tentative_paiement : lecture seule côté authenticated
create policy tentative_paiement_select_scope
  on public.tentative_paiement
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.creance c
      where c.id = tentative_paiement.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  );

-- paiement : lecture seule côté authenticated
create policy paiement_select_scope
  on public.paiement
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.creance c
      where c.id = paiement.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  );

-- payment_authorization : lecture seule côté authenticated
create policy payment_authorization_select_scope
  on public.payment_authorization
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- dossier_suivi
create policy dossier_suivi_select_scope
  on public.dossier_suivi
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.creance c
      where c.id = dossier_suivi.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  );

create policy dossier_suivi_insert_scope
  on public.dossier_suivi
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.creance c
      where c.id = dossier_suivi.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  );

create policy dossier_suivi_update_scope
  on public.dossier_suivi
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.creance c
      where c.id = dossier_suivi.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  )
  with check (
    exists (
      select 1
      from public.creance c
      where c.id = dossier_suivi.creance_id
        and c.prestataire_id = public.current_prestataire_id()
    )
  );

-- regle
create policy regle_select_scope
  on public.regle
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy regle_insert_scope
  on public.regle
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

create policy regle_update_scope
  on public.regle
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (prestataire_id = public.current_prestataire_id());

create policy regle_delete_scope
  on public.regle
  for delete
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

-- conversation
create policy conversation_select_scope
  on public.conversation
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy conversation_insert_scope
  on public.conversation
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

create policy conversation_update_scope
  on public.conversation
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (prestataire_id = public.current_prestataire_id());

-- message : insert + select, pas update/delete (triggers en plus)
create policy message_select_scope
  on public.message
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversation conv
      where conv.id = message.conversation_id
        and conv.prestataire_id = public.current_prestataire_id()
    )
  );

create policy message_insert_scope
  on public.message
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversation conv
      where conv.id = message.conversation_id
        and conv.prestataire_id = public.current_prestataire_id()
    )
  );

-- approval_request
create policy approval_request_select_scope
  on public.approval_request
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy approval_request_insert_scope
  on public.approval_request
  for insert
  to authenticated
  with check (
    prestataire_id = public.current_prestataire_id()
    and status = 'pending'
  );

create policy approval_request_update_scope
  on public.approval_request
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (
    prestataire_id = public.current_prestataire_id()
    and (
      approved_by is null
      or approved_by = auth.uid()
    )
  );

-- audit_log : lecture + append
create policy audit_log_select_scope
  on public.audit_log
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy audit_log_insert_scope
  on public.audit_log
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

-- processed_webhook_event : aucune policy utilisateur — service_role uniquement
