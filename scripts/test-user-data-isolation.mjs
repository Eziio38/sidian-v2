#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestConfig,
  LOCAL_DEMO_ANON_KEY,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
} from "./lib/assert-local-supabase.mjs";
import { withLocalOnlyFetch } from "./lib/local-only-fetch.mjs";

const localConfig = assertLocalTestConfig();
const admin = createClient(
  localConfig.url,
  LOCAL_DEMO_SERVICE_ROLE_KEY,
  withLocalOnlyFetch({
    auth: { autoRefreshToken: false, persistSession: false },
  }),
);

function localClient(key, options = {}) {
  return createClient(
    localConfig.url,
    key,
    withLocalOnlyFetch({
      auth: { autoRefreshToken: false, persistSession: false },
      ...options,
    }),
  );
}

async function createUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("user_create_failed");
  return data.user;
}

async function signIn(email, password) {
  const auth = localClient(LOCAL_DEMO_ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("sign_in_failed");
  return localClient(LOCAL_DEMO_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertOne(table, values, columns = "id") {
  const { data, error } = await admin
    .from(table)
    .insert(values)
    .select(columns)
    .single();
  if (error || !data) throw error ?? new Error(`${table}_insert_failed`);
  return data;
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "IsolationTest123!";
  const emailA = `isolation-a-${suffix}@sidian.test`;
  const emailB = `isolation-b-${suffix}@sidian.test`;
  const userA = await createUser(emailA, password);
  const userB = await createUser(emailB, password);

  const prestataireA = await insertOne("prestataire", {
    user_id: userA.id,
    nom: "Isolation A",
    email: emailA,
  });
  const prestataireB = await insertOne("prestataire", {
    user_id: userB.id,
    nom: "Isolation B",
    email: emailB,
  });
  const projectA = await insertOne(
    "conversation_project",
    {
      prestataire_id: prestataireA.id,
      name: "Projet privé A",
      icon: "folder",
      color: "sidian",
    },
    "id, name",
  );
  const projectB = await insertOne(
    "conversation_project",
    {
      prestataire_id: prestataireB.id,
      name: "Projet privé B",
      icon: "briefcase",
      color: "violet",
    },
    "id, name",
  );
  const conversationA = await insertOne("conversation", {
    prestataire_id: prestataireA.id,
    project_id: projectA.id,
  });
  const conversationB = await insertOne("conversation", {
    prestataire_id: prestataireB.id,
    project_id: projectB.id,
  });
  const messageA = await insertOne("message", {
    conversation_id: conversationA.id,
    emetteur: "prestataire",
    canal: "interface",
    actor_type: "human",
    contenu: "Message persistant A",
  });
  const messageB = await insertOne("message", {
    conversation_id: conversationB.id,
    emetteur: "prestataire",
    canal: "interface",
    actor_type: "human",
    contenu: "Message privé B",
  });

  const clientA = await signIn(emailA, password);
  const clientB = await signIn(emailB, password);

  const { data: conversationsSeenByA, error: readConversationError } =
    await clientA.from("conversation").select("id, project_id");
  if (readConversationError) throw readConversationError;
  assert(
    (conversationsSeenByA ?? []).some((row) => row.id === conversationA.id),
    "A ne retrouve pas sa conversation persistée après relecture",
  );
  assert(
    !(conversationsSeenByA ?? []).some((row) => row.id === conversationB.id),
    "A peut lire la conversation de B",
  );

  const { data: renamedOwnConversation, error: renameOwnError } = await clientA
    .from("conversation")
    .update({ title: "Suivi privé A" })
    .eq("id", conversationA.id)
    .select("id, title");
  assert(
    Boolean(renameOwnError) && (renamedOwnConversation ?? []).length === 0,
    "Le client authentifié peut contourner l’API métier pour renommer une discussion",
  );

  const { data: renamedForeignConversation, error: renameForeignError } =
    await clientA
      .from("conversation")
      .update({ title: "Titre injecté" })
      .eq("id", conversationB.id)
      .select("id");
  assert(
    Boolean(renameForeignError) &&
      (renamedForeignConversation ?? []).length === 0,
    "A peut renommer la conversation de B",
  );

  const { data: messagesSeenByA, error: readMessageError } = await clientA
    .from("message")
    .select("id");
  if (readMessageError) throw readMessageError;
  assert(
    (messagesSeenByA ?? []).some((row) => row.id === messageA.id),
    "A ne retrouve pas son message persistant",
  );
  assert(
    !(messagesSeenByA ?? []).some((row) => row.id === messageB.id),
    "A peut lire le message de B",
  );

  const { data: projectsSeenByA, error: readProjectError } = await clientA
    .from("conversation_project")
    .select("id");
  if (readProjectError) throw readProjectError;
  assert(
    (projectsSeenByA ?? []).some((row) => row.id === projectA.id),
    "A ne retrouve pas son projet persistant",
  );
  assert(
    !(projectsSeenByA ?? []).some((row) => row.id === projectB.id),
    "A peut lire le projet de B",
  );

  const { data: updatedForeignProject, error: updateForeignError } =
    await clientA
      .from("conversation_project")
      .update({ name: "Compromis" })
      .eq("id", projectB.id)
      .select("id");
  if (updateForeignError) throw updateForeignError;
  assert(
    (updatedForeignProject ?? []).length === 0,
    "A peut modifier le projet de B",
  );

  const { data: deletedForeignProject, error: deleteForeignError } =
    await clientA
      .from("conversation_project")
      .delete()
      .eq("id", projectB.id)
      .select("id");
  if (deleteForeignError) throw deleteForeignError;
  assert(
    (deletedForeignProject ?? []).length === 0,
    "A peut supprimer le projet de B",
  );

  const { data: deletedForeignConversation, error: deleteConversationError } =
    await clientA
      .from("conversation")
      .delete()
      .eq("id", conversationB.id)
      .select("id");
  assert(
    Boolean(deleteConversationError) ||
      (deletedForeignConversation ?? []).length === 0,
    "A peut supprimer la conversation de B",
  );

  const { error: crossProjectError } = await clientA
    .from("conversation")
    .update({ project_id: projectB.id })
    .eq("id", conversationA.id);
  assert(
    Boolean(crossProjectError),
    "A peut rattacher sa conversation au projet de B",
  );

  const { data: crossOwnerInsert, error: crossOwnerInsertError } = await clientA
    .from("conversation_project")
    .insert({
      prestataire_id: prestataireB.id,
      name: "Projet injecté",
      icon: "folder",
      color: "sidian",
    })
    .select("id");
  assert(
    Boolean(crossOwnerInsertError) && (crossOwnerInsert ?? []).length === 0,
    "A peut créer une ressource avec le propriétaire B",
  );

  const { data: deletedOwnProject, error: deleteOwnProjectError } = await clientA
    .from("conversation_project")
    .delete()
    .eq("id", projectA.id)
    .select("id");
  if (deleteOwnProjectError) throw deleteOwnProjectError;
  assert(
    (deletedOwnProject ?? []).length === 1,
    "A ne peut pas supprimer son propre projet",
  );

  const { data: preservedConversation, error: preservedConversationError } =
    await clientA
      .from("conversation")
      .select("id, project_id")
      .eq("id", conversationA.id)
      .single();
  if (preservedConversationError) throw preservedConversationError;
  assert(
    preservedConversation.project_id === null,
    "supprimer un projet ne détache pas la conversation",
  );
  const { data: preservedMessages, error: preservedMessagesError } =
    await clientA
      .from("message")
      .select("id")
      .eq("conversation_id", conversationA.id);
  if (preservedMessagesError) throw preservedMessagesError;
  assert(
    (preservedMessages ?? []).some((row) => row.id === messageA.id),
    "supprimer un projet a supprimé ses messages",
  );

  await clientA.auth.signOut();
  const anonymous = localClient(LOCAL_DEMO_ANON_KEY);
  const { data: afterSignOut } = await anonymous
    .from("conversation")
    .select("id")
    .eq("id", conversationA.id);
  assert(
    (afterSignOut ?? []).length === 0,
    "les données privées restent accessibles après déconnexion",
  );

  const { data: rowsSeenByB, error: bReadError } = await clientB
    .from("conversation")
    .select("id");
  if (bReadError) throw bReadError;
  assert(
    (rowsSeenByB ?? []).some((row) => row.id === conversationB.id) &&
      !(rowsSeenByB ?? []).some((row) => row.id === conversationA.id),
    "le changement de compte mélange les conversations",
  );

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw bucketError;
  assert(
    !(buckets ?? []).some((bucket) => bucket.public),
    "un bucket public permettrait de contourner l'isolation des documents",
  );

  // Préférence d'apparence : donnée par compte, elle doit suivre les mêmes
  // règles d'isolation que le reste — et rester inaltérable depuis PostgREST.
  const { data: themeA, error: themeAError } = await clientA.rpc(
    "set_current_prestataire_theme_preference",
    { p_theme: "dark" },
  );
  if (themeAError) throw themeAError;
  // La RPC renvoie directement l'enum, pas la ligne prestataire.
  assert(
    themeA === "dark",
    "la préférence d'apparence ne s'enregistre pas",
  );

  const { data: prestataireSeenByB } = await clientB
    .from("prestataire")
    .select("id, theme_preference");
  assert(
    !(prestataireSeenByB ?? []).some((row) => row.id === prestataireA.id),
    "B ne doit pas voir la préférence d'apparence de A",
  );

  const { error: directThemeWrite } = await clientA
    .from("prestataire")
    .update({ theme_preference: "light" })
    .eq("id", prestataireA.id);
  assert(
    Boolean(directThemeWrite),
    "l'écriture directe de la préférence via PostgREST doit être refusée",
  );

  const { error: invalidTheme } = await clientA.rpc(
    "set_current_prestataire_theme_preference",
    { p_theme: "neon" },
  );
  assert(
    Boolean(invalidTheme),
    "une valeur d'apparence hors énumération doit être refusée",
  );

  console.log("✓ isolation multi-utilisateurs conversations/messages/projets");
  console.log("✓ préférence d'apparence isolée, écriture directe refusée");
  console.log("✓ création forcée sur le propriétaire authentifié");
  console.log("✓ suppression projet sans suppression des conversations/messages");
  console.log("✓ déconnexion et changement de compte sans fuite");
  console.log("✓ aucun bucket public pour les documents sensibles");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
