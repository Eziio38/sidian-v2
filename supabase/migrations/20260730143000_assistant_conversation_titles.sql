-- Titre manuel optionnel des discussions.
-- Le titre automatique reste dérivé localement tant que cette valeur est NULL.

alter table public.conversation
  add column if not exists title text;

alter table public.conversation
  drop constraint if exists conversation_title_ck;

alter table public.conversation
  add constraint conversation_title_ck
  check (
    title is null
    or (
      char_length(btrim(title)) between 1 and 80
      and title = btrim(title)
    )
  );

comment on column public.conversation.title is
  'Titre manuel facultatif de la discussion, limité à 80 caractères.';
