-- Persistance tenant-scopée des projets de conversations.
--
-- Migration additive et non destructive :
-- - les conversations existantes restent sans projet ;
-- - supprimer un projet détache ses conversations sans les supprimer ;
-- - aucun propriétaire n'est accepté depuis une donnée métier indirecte.

create table public.conversation_project (
  id uuid primary key default gen_random_uuid(),
  prestataire_id uuid not null
    references public.prestataire (id) on delete restrict,
  name text not null,
  icon text not null default 'folder',
  color text not null default 'sidian',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint conversation_project_name_ck
    check (char_length(btrim(name)) between 1 and 80),
  constraint conversation_project_icon_ck
    check (
      icon in (
        'folder',
        'briefcase',
        'user',
        'building',
        'document',
        'invoice',
        'star',
        'shield'
      )
    ),
  constraint conversation_project_color_ck
    check (color in ('sidian', 'violet', 'green', 'amber', 'orange', 'coral'))
);

create index conversation_project_prestataire_created_idx
  on public.conversation_project (prestataire_id, created_at desc);

create trigger conversation_project_set_updated_at
before update on public.conversation_project
for each row execute function public.set_updated_at();

alter table public.conversation
  add column project_id uuid
    references public.conversation_project (id) on delete set null;

create index conversation_project_id_idx
  on public.conversation (project_id)
  where project_id is not null;

create or replace function public.enforce_conversation_project_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_project_prestataire_id uuid;
begin
  if new.project_id is null then
    return new;
  end if;

  select project.prestataire_id
  into v_project_prestataire_id
  from public.conversation_project project
  where project.id = new.project_id;

  if v_project_prestataire_id is null
    or v_project_prestataire_id is distinct from new.prestataire_id
  then
    raise exception 'conversation.project_id hors scope prestataire'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_conversation_project_scope()
  from public, anon, authenticated, service_role;

create trigger conversation_project_scope_check
before insert or update of project_id, prestataire_id on public.conversation
for each row execute function public.enforce_conversation_project_scope();

alter table public.conversation_project enable row level security;

revoke all on table public.conversation_project from public, anon;
revoke all on table public.conversation_project from authenticated;
grant select, insert, update, delete
  on table public.conversation_project
  to authenticated;
grant all on table public.conversation_project to service_role;

create policy conversation_project_select_scope
  on public.conversation_project
  for select
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

create policy conversation_project_insert_scope
  on public.conversation_project
  for insert
  to authenticated
  with check (prestataire_id = public.current_prestataire_id());

create policy conversation_project_update_scope
  on public.conversation_project
  for update
  to authenticated
  using (prestataire_id = public.current_prestataire_id())
  with check (prestataire_id = public.current_prestataire_id());

create policy conversation_project_delete_scope
  on public.conversation_project
  for delete
  to authenticated
  using (prestataire_id = public.current_prestataire_id());

comment on table public.conversation_project is
  'Projet d’organisation des conversations, strictement rattaché à un prestataire.';
comment on column public.conversation.project_id is
  'Classement optionnel. ON DELETE SET NULL conserve intégralement la conversation.';
