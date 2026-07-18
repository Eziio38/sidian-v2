# SIDIAN — 03 · ARCHITECTURE TECHNIQUE (V2)
## Modèle de données, machines d'état, intégrations — le comment, jamais le pourquoi

**Statut :** document purement technique. Toute justification produit ou métier renvoie à 02 (PRD) ; toute justification de contrainte externe renvoie à 01 (Fondations). Réécrit intégralement le 14 juillet 2026 ; réaligné le 16 juillet 2026 sur le schéma MVP appliqué (migrations `2026071512*`), la phase Auth et les invariants de sécurité cibles.

**Stack conservée :** Next.js / Supabase (Postgres + RLS) / Stripe Connect. Développement Cursor.

**Convention de marquage :**
- champs et contraintes **présents dans les migrations actives** : décrits sans marqueur ;
- écarts nécessitant une évolution de schéma : **`[MIGRATION À PRÉVOIR]`** ;
- points dépendant d'une confirmation externe : **`[VALIDATION RESTANTE]`**.

---

## 1. Modèle de données — entités et champs clés

**Note de vocabulaire :** `creance` est un nom d'entité interne. Il n'apparaît jamais tel quel dans l'interface ou la communication vue par le prestataire ou le client — le terme produit est « paiement à recevoir » (cf. 02, §1). Toute chaîne de caractères destinée à l'affichage doit utiliser le vocabulaire produit, jamais le nom de la table.

**Périmètre :** les entités ci-dessous sont celles du MVP tel que scopé en 02 §8. Tout ce qui relève de l'agrégation bancaire est délibérément absent d'ici et regroupé en §12 (Architecture différée).

**Réalité schéma (juillet 2026) :** 13 tables versionnées dans `supabase/migrations/` — `prestataire`, `client_payeur`, `creance`, `tentative_paiement`, `paiement`, `payment_authorization`, `dossier_suivi`, `regle`, `conversation`, `message`, `approval_request`, `audit_log`, `processed_webhook_event`.

### `prestataire`

**Champs présents (migrations actives) :**
`id`, `user_id` (uuid, **unique**, FK `auth.users`, `on delete restrict` — un utilisateur Auth = un prestataire au MVP), `nom`, `email`, `subscription_status` (`trialing` / `active` / `past_due` / `cancelled`), `pricing_version` (texte, défaut `early_access_49`), `subscription_started_at` (nullable), `early_access_price_locked_until` (nullable), `profil_agent_defaut` (`controle` / `delegation`), `platform_fee_basis_points` (integer ≥ 0, défaut 0), `created_at`.

**Projection Stripe Connect — `[MIGRATION À PRÉVOIR]`** (absente du schéma actuel) :
- `stripe_account_id` (nullable)
- `stripe_charges_enabled` (bool)
- `stripe_payouts_enabled` (bool, si nécessaire)
- `stripe_details_submitted` (bool)
- statut synthétique des exigences Connect (ex. `stripe_requirements_status` ou équivalent)
- `stripe_status_synced_at` (timestamptz)

**Stripe reste la source externe de vérité.** La base conserve uniquement une **projection locale synchronisée** (webhooks + revérifications serveur). `stripe_charges_enabled` n'est **jamais** une « source de vérité unique » : c'est un cache local. Une revérification Stripe live est obligatoire avant toute action critique (création de session payable, envoi d'un lien partageable, tentative `prelevement_auto`, passage d'un compte à « payable » côté produit).

**Le prix commercial n'est jamais utilisé comme logique métier** dans le suivi des paiements. Aucun quota d'utilisateurs, de clients ou d'automatisation lié à un plan n'est codé au MVP.

**Opérateur unique au MVP :** un compte `prestataire` possède un seul utilisateur principal via `user_id` — aucune architecture RBAC.

**Onboarding (SID-SEC-001 — corrigé localement) :** création via RPC `ensure_prestataire_for_current_user(p_nom)` ; mise à jour du nom via `update_current_prestataire_name(p_nom)` ; aucun INSERT/UPDATE/DELETE PostgREST `authenticated` sur `prestataire` ; ACL `authenticated` = **SELECT uniquement** (MAINTAIN révoqué). Email stocké sous forme canonique `lower(btrim(auth.users.email))` (réconciliation si `IS DISTINCT FROM`) ; champs commerciaux et `created_at` immuables côté client.

### Lien de paiement — préparé / payable / partageable

Formalisation technique (traduction et correction de 02 §4.2) :

1. La **ance est créée.
2. Une **ressource ou URL Sidian stable et opaque** peut être créée (identifiant non prédictible, non égal à `creance_id` en clair).
3. Cette URL vérifie **côté serveur** le prestataire, la créance et l'état Stripe (projection + revérification si nécessaire).
4. **Aucune session Stripe payable** n'est créée ni exposée si le compte connecté n'est pas éligible (`charges_enabled` faux côté Stripe).
5. Lorsque le compte est payable, une **session Stripe fraîche** peut être créée à la demande.
6. Un lien **non payable** n'est **jamais** présenté comme partageable (ni à l'agent, ni à l'interface, ni au client).

| État | Signification |
|---|---|
| **Préparé** | Créance créée ; URL Sidian stable éventuellement réservée ; aucune promesse de paiement Stripe. |
| **Payable** | Compte Connect éligible côté Stripe (revérifié) ; une session Checkout / PaymentIntent peut être créée. |
| **Partageable** | Lien exposable au prestataire / envoyable au client / cliquable — uniquement si **payable** est vrai au moment de l'exposition. |

**Interdit :** affirmer qu'une URL ou session Stripe payable est générée et accessible dès la seule création de la créance.

### `client_payeur`

**Champs présents :** `id`, `prestataire_id`, `nom`, `email`, `historique_paiements_reguliers`, `created_at`, `archived_at` (archivage logique — filtre applicatif, hors policies RLS).

**Mutations (SID-PROD-001) :** RPC `create_current_client_payeur(p_nom, p_email, p_creation_key)`, `update_current_client_payeur` (nom/email uniquement), `archive_current_client_payeur` (refusé si créance non archivée — `CLIENT_HAS_ACTIVE_CREANCES` ; idempotent si déjà archivé). ACL `authenticated` = **SELECT uniquement**. Email stocké canonique `lower(btrim(...))` + validation SQL bornée. Pas d’unicité email par prestataire. `creation_key` UUID unique par prestataire (idempotence création).

### `creance` — entité pivot
`id`, `prestataire_id` (FK), `client_payeur_id` (FK), `montant` (bigint, MVP 1…100000000 centimes), `devise` (`EUR` uniquement), `origine` (`facture_externe` / `acompte` / `echeancier` / `abonnement` / `import_manuel`), `reference_externe` (nullable), `date_echeance`, `etat` (cf. §2.1 — valeurs DB sans accents : `BROUILLON`, `OUVERTE`, `PARTIELLEMENT_REGLEE`, `REGLEE`, `EN_LITIGE`, `ANNULEE`, `IRRECOUVRABLE`), `libelle` (nullable, ≤ 200), `archived_at` (nullable), `creation_key` (UUID, unique par prestataire), `created_at`, `updated_at`.

Trigger de scope : `client_payeur` et `creance` doivent partager le même `prestataire_id`.

**Mutations (SID-PROD-001) :** RPC `create_current_creance(..., p_creation_key)` (toujours `etat = BROUILLON`, `origine = import_manuel`, devise `EUR` exacte), `update_current_creance_draft` (uniquement si `BROUILLON` : client, libellé, montant, devise, échéance, référence — verrouille `creance` puis `client_payeur` cible `FOR UPDATE`), `archive_current_creance` (idempotent). ACL `authenticated` = **SELECT uniquement**. Invariant concurrent : aucune créance active sur un client archivé (`FOR UPDATE` partagé create/update/archive). Terme UI : « paiement à recevoir » — jamais « facture » comme objet principal ; jamais « créance » visible.

**Pennylane / liens externes :** hors SID-PROD-001 — prévu en SID-INT-001 via tables de liaison (`external_integrations` / `external_invoice_links`), pas via colonnes `external_*` sur ces tables.

### `tentative_paiement` — essai, pas règlement confirmé
`id`, `creance_id` (FK), `montant` (bigint > 0), `moyen` (`carte` / `sepa_core`), `source` (`lien_agent` / `prelevement_auto`), `stripe_payment_intent_id` (nullable, unique si non null), `etat` (cf. §2.2), `echec_code` (nullable), `echec_message` (nullable), `created_at`.

**Toute tentative, y compris échouée, crée une ligne ici — jamais dans `paiement`.** Authenticated : lecture seule (pas d'INSERT navigateur).

### `paiement` — règlements confirmés uniquement
`id`, `creance_id` (FK), `tentative_paiement_id` (FK nullable, unique si non null), `montant` (bigint > 0), `source`, `created_at`.

**Sources MVP :** `lien_agent`, `prelevement_auto`.

**Enum actuelle** contient aussi `detecte_hors_sidian` (migrations). **Hors périmètre produit MVP** — réservé à l'architecture différée (§12). Ne pas l'utiliser pour une détection automatique. Si une déclaration manuelle hors plateforme est retenue produit : introduire `declare_manuellement_hors_sidian` **`[MIGRATION À PRÉVOIR]`** (remplacement / ajout d'enum), avec écriture uniquement via commande serveur auditée — jamais via agrégation bancaire.

Trigger de scope : si `tentative_paiement_id` est renseigné, il doit référencer la même `creance_id`. Authenticated : lecture seule.

### `payment_authorization`
`id`, `client_payeur_id` (FK), `prestataire_id` (FK), `type` (`card_off_session` / `sepa_core_mandate`), `stripe_payment_method_id`, `stripe_mandate_id` (nullable), `etat` (cf. §2.3), `is_default` (bool), `authorized_at`, `authorization_text_version`, `authorization_channel`, `revoked_at` (nullable), `created_at`.

Contraintes actives :
- index unique partiel : au plus une `is_default` par couple `(client_payeur_id, prestataire_id)` ;
- **`is_default = true` implique `etat = ACTIVE`** (`payment_authorization_default_requires_active`) ;
- trigger de scope client × prestataire.

Le remplacement d'une autorisation par défaut doit être **transactionnel** (désactiver l'ancienne `is_default`, activer la nouvelle, même transaction). Authenticated : lecture seule au MVP.

### `regle`
`id`, `prestataire_id` (FK), `client_payeur_id` (nullable), `parametre`, `valeur` (jsonb), `origine` (`defaut` / `instruction_naturelle`), `libelle_instruction_origine` (nullable), `actif`, `created_at`. Trigger de scope si `client_payeur_id` renseigné.

### `conversation` et `message` — deux tables distinctes

#### `conversation` (migrations actives)
`id`, `prestataire_id` (FK, **présent**), `creance_id` (nullable), `client_payeur_id` (nullable), `created_at`, `updated_at`.

Trigger de scope : `creance_id` / `client_payeur_id` doivent appartenir au même `prestataire_id`.

**`[MIGRATION À PRÉVOIR]`** pour le jeton de réponse publique :
- `reply_token_hash` (empreinte du jeton opaque — jamais le jeton en clair)
- `reply_token_revoked_at` (nullable)

Le jeton public doit être opaque, non prédictible, révocable, et stocké sous forme d'empreinte. Il ne doit jamais exposer `creance_id` en clair dans une adresse email publique (cf. PRD §4.5).

#### `message` (migrations actives)
`id`, `conversation_id` (FK), `emetteur` (`agent` / `prestataire` / `client`), `contenu`, `canal` (`email` / `interface`), `actor_type` (`human` / `sidian_agent` / `system` / `external_integration`), `created_at`.

**`[MIGRATION À PRÉVOIR]` :**
- `actor_provider` (nullable)
- `actor_model` (nullable)
- `external_message_id` (nullable)

**Append-only pour les rôles applicatifs ordinaires** (triggers empêchent UPDATE/DELETE sur `message`). Compatible avec une **procédure privilégiée** de rétention, purge ou anonymisation auditée (service_role / opération contrôlée) — pas avec un DELETE navigateur.

**SID-SEC-004 (cible) :** la provenance (`emetteur`, `actor_type`, et futurs `actor_provider` / `actor_model`) est imposée côté serveur — le navigateur ne choisit pas librement qu'un message « vient de l'agent ».

### `dossier_suivi`
`id`, `creance_id` (FK, **unique**), `etat` (cf. §2.4), `last_client_activity_at`, `last_agent_action_at`, `next_action_at`, `escalation_reason`, `created_at`, `updated_at`, `clos_at` (nullable). Une créance possède au plus un dossier principal au MVP.

### `approval_request`
`id`, `prestataire_id` (FK), `creance_id` (nullable, scopé), `type` (`formal_action` / `rule_change` / `depassement_seuil` / `autre`), `requested_by_actor_type`, `requested_by_provider` (nullable), `payload` (jsonb), `status` (`pending` / `approved` / `rejected` / `expired`), `approved_by` (nullable), `decided_at`, `created_at`, `expires_at`.

**SID-SEC-003 (cible) :** payload immuable après création ; décision (`status`, `approved_by`, `decided_at`) séparée et bornée — pas de mutation libre du payload depuis le client.

### `audit_log`
`id`, `prestataire_id` (FK, **présent**), `actor_type`, `actor_provider` (nullable), `actor_model` (nullable), `action`, `entity_type`, `entity_id` (nullable), `metadata` (jsonb), `created_at`.

Append-only pour rôles ordinaires (triggers UPDATE/DELETE interdits). Trigger de cohérence scope quand `entity_type`/`entity_id` est résolvable.

**SID-SEC-002 (cible) :** écriture uniquement via une primitive serveur de confiance — pas d'INSERT libre authentifié depuis le navigateur pour forger une trace.

### `processed_webhook_event` — état actuel vs cible

**Schéma actuel (migrations) :** `id` (= `event_id` Stripe, PK), `type`, `processed_at`.

**Modèle documentaire cible — `[MIGRATION À PRÉVOIR]` :**
- `id`
- `type`
- `stripe_connected_account_id` (nullable / text)
- `received_at`
- `processing_status`
- `processing_attempts`
- `processed_at` (nullable)
- `last_error_code` (nullable)

Voir §3 pour l'acquisition atomique.

---

## 2. Machines d'état — quatre machines séparées, jamais mélangées

**Principe :** l'état financier de la créance, la tentative, l'autorisation et le suivi relationnel sont quatre domaines distincts. Un échec de carte ne doit jamais faire glisser à lui seul l'état financier affiché.

Les libellés ci-dessous utilisent les accents pour la lisibilité ; les **valeurs d'enum Postgres** sont sans accents (ex. `PARTIELLEMENT_REGLEE`, `CREEE`, `ECHOUEE`, `REVOQUEE`).

### 2.1 Créance

```
BROUILLON
  │
  ▼
OUVERTE
  │
  ├──[paiement partiel confirmé]──► PARTIELLEMENT_RÉGLÉE ──[solde atteint]──► RÉGLÉE
  ├──[paiement total confirmé]────► RÉGLÉE
  ├──[litige détecté]─────────────► EN_LITIGE ──[résolution]──► OUVERTE ou ANNULÉE ou RÉGLÉE
  ├──[prestataire annule]─────────► ANNULÉE
  └──[silence prolongé, décision prestataire]──► IRRÉCOUVRABLE
```

`RÉGLÉE`, `ANNULÉE`, `IRRÉCOUVRABLE` sont terminaux. **SID-SEC-005 (cible) :** toute transition passe par une commande métier déterministe — pas d'UPDATE client direct de `etat`.

### 2.2 Tentative de paiement

```
CRÉÉE
  ├──► NÉCESSITE_ACTION_CLIENT
  ├──► EN_TRAITEMENT             (SEPA : délai avant confirmation)
  ├──► RÉUSSIE                   → crée une ligne `paiement`
  ├──► ÉCHOUÉE                   → renseigne `echec_code` / `echec_message`
  └──► ANNULÉE
```

**Règle verrouillée :** une tentative ne passe à `RÉUSSIE` que sur événement Stripe fiable (webhook), jamais par écoulement de délai. Une tentative échouée ne modifie jamais directement `creance.etat`.

### 2.3 Autorisation de paiement

```
NON_PROPOSÉE → PROPOSÉE → EN_CONFIGURATION → ACTIVE | REFUSÉE
ACTIVE → RÉVOQUÉE | EXPIRÉE | SUSPENDUE → ACTIVE | RÉVOQUÉE
```

Seul un `payment_authorization` à l'état `ACTIVE` et `is_default = true` autorise une `tentative_paiement` de source `prelevement_auto` au MVP. **`is_default = true` implique `etat = ACTIVE`** (contrainte SQL active).

### 2.4 Dossier de suivi

```
PRÉVENTION → ÉCHÉANCE → SUIVI_AMIABLE
  ├──► PAUSE_LITIGE
  ├──► ATTENTE_CLIENT
  ├──► ATTENTE_PRESTATAIRE
  └──► ESCALADE_HUMAINE → CLOS
```

`CLOS` est terminal pour le dossier ; il n'implique rien à lui seul sur `creance.etat`.

---

## 3. Idempotence, webhooks et retries

### 3.1 Idempotence métier
- Création de `tentative_paiement` idempotente vis-à-vis de `stripe_payment_intent_id` (unique partiel).
- Création de `paiement` depuis une tentative : unique sur `tentative_paiement_id` non null.

### 3.2 Webhooks Stripe — acquisition atomique (architecture cible)

Remplace le modèle « vérifier l'absence puis traiter » (sujet à course).

1. Vérification de signature sur le **corps brut**.
2. Insertion **atomique** de l'événement avec contrainte unique sur `id` (= `event_id` Stripe).
3. Doublon reconnu par **conflit unique** (événement déjà acquis) → réponse 200 sans retraitement.
4. Mise en file.
5. Traitement asynchrone.
6. Retries bornés.
7. État de traitement (`processing_status`).
8. Erreur normalisée (`last_error_code`).
9. Marquage final (`processed_at` lorsque terminal succès).

**Schéma actuel :** `processed_webhook_event (id, type, processed_at)` — insuffisant pour les étapes 6–8. **`[MIGRATION À PRÉVOIR]`** vers le modèle du §1.

### 3.3 Retries de tentative
**MVP : `retry_policy = none`** — une tentative échouée repasse en flux de lien manuel + notification prestataire. Une politique plus riche reste une hypothèse post-MVP (rail, code d'échec, auth, litige).

**Ne jamais rejouer aveuglément une requête Stripe au résultat ambigu** — cf. §6 (mode dégradé).

---

## 4. Registre encadré — garde-fous système

Les garde-fous du PRD §3 sont des **contraintes système**, jamais de simples instructions LLM :

- Action formelle → transition `dossier_suivi` vers `ESCALADE_HUMAINE` + `approval_request` — aucun chemin direct contentieux.
- Dépassement de seuils `regle` → même mise en attente, vérifiée serveur.
- Détection de litige : LLM **et** règles/mots-clés en parallèle (biais faux positif).

**Exécution automatique déjà autorisée** (`prelevement_auto`) : checklist déterministe côté service, jamais déléguée au modèle :
1. `creance.etat` ∈ {`OUVERTE`, `PARTIELLEMENT_REGLEE`} ;
2. `dossier_suivi.etat` ≠ `PAUSE_LITIGE` ;
3. montant ≤ solde restant ;
4. autorisation `ACTIVE` + `is_default` revérifiée à l'exécution ;
5. limites `regle` respectées ;
6. compte Connect payable (projection + revérification si nécessaire) ;
7. concordance scope Stripe (§5.2).

**SID-SEC-005 :** transitions métier uniquement via commandes déterministes.

Table `regle` — paramètres de départ : délai de grâce, montant max d'étalement, nb demandes avant escalade, seuil validation humaine, vitesse d'escalade du ton, plafond de fermeté, canaux, fréquence max, horaires. **[HYPOTHÈSE — liste à étendre].**

---

## 5. Intégrations externes — périmètre MVP

### 5.1 Stripe Connect (direct charge)

Le prestataire est merchant of record. Commission via `application_fee_amount` / `platform_fee_basis_points` (**0** pendant Early Access). Payment Element : carte + SEPA Core, sans masquage d'un rail sur un seuil de montant Sidian.

Webhooks minimaux : tentative réussie/échouée, authentification requise, autorisation créée/révoquée, dispute, mises à jour compte Connect (`account.updated`).

**Lien de paiement :** URL Sidian stable opaque → contrôle serveur → session Stripe fraîche **seulement si payable**. Voir §1.

**`[VALIDATION RESTANTE]`** Limites SEPA Direct Debit et plafonds nouveaux comptes Connect.

### 5.2 Scope Stripe Connect — non négociable

Les direct charges et leurs objets vivent dans le **périmètre du compte connecté**.

Toute opération Stripe vérifie la concordance entre :
- `prestataire_id`
- `stripe_account_id` (projection locale)
- PaymentIntent
- Customer
- PaymentMethod
- Mandate
- événement webhook (`stripe_connected_account_id`)

**Un objet Stripe d'un prestataire ne peut jamais être utilisé pour un autre.**

### 5.3 SEPA Core — prénotification

**`[VALIDATION RESTANTE]`** — dépend de la configuration Stripe réelle et des obligations légales applicables.

À documenter et implémenter explicitement :
- **qui** envoie la prénotification (Sidian vs Stripe) ;
- **quand** elle est envoyée (délai avant débit) ;
- **comment** sa réussite est prouvée (événement, statut, journal) ;
- **si** son échec bloque le débit ;
- **version du texte** d'autorisation / préavis ;
- **date d'envoi** ;
- **autorisation et mandat** concernés (`payment_authorization_id`, `stripe_mandate_id`).

Ces preuves doivent être auditables (`audit_log` et/ou champs dédiés — `[MIGRATION À PRÉVOIR]` si champs manquants).

### 5.4 Outil de facturation tiers
Hors MVP. Lecture seule future pour `reference_externe` — jamais d'écriture dans l'outil tiers.

---

## 6. Sécurité

### 6.1 Invariants actifs (migrations / code)

- RLS sur toutes les tables applicatives exposées.
- Aucun accès `anon` métier (`REVOKE ALL` sur les 13 tables).
- Isolation tenant via JWT authenticated + `current_prestataire_id()` (`SECURITY DEFINER` + `search_path = public`).
- Triggers de scope cross-tenant (creance, authorization, conversation, approval, regle, paiement/tentative, audit).
- Immutabilité `message` et `audit_log` pour rôles ordinaires.
- Protection UPDATE des champs commerciaux sensibles `prestataire` côté `authenticated`.
- Tables financières / système (`tentative_paiement`, `paiement`, `payment_authorization`, `processed_webhook_event`) : pas d'écriture navigateur (SELECT seul ou aucun grant authenticated).
- `service_role` uniquement dans des modules `server-only` (jamais importable client).
- Auth : `getUser()` serveur ; email prestataire issu de Auth confirmé ; redirects internes allowlistés.

### 6.2 Architecture cible de confiance (audit — non prétendue corrigée)

| ID | Invariant cible |
|---|---|
| SID-SEC-001 | Onboarding prestataire de confiance — **corrigé localement** (RPC création + RPC nom ; ACL SELECT seul ; email canonique ; pas de mutation PostgREST) |
| SID-SEC-002 | `audit_log` écrit uniquement par primitive serveur |
| SID-SEC-003 | Approbation : payload immuable, décision séparée |
| SID-SEC-004 | Provenance des messages imposée côté serveur |
| SID-SEC-005 | Transitions métier uniquement via commandes déterministes |
| SID-SEC-006 | Rate limiting obligatoire (Auth, callbacks publics, webhooks, IA) |
| SID-SEC-007 | CI bloquante (lint, typecheck, tests schéma/Auth, build) |
| SID-SEC-008 | Tests administratifs / service_role strictement locaux |

Risques établis à traiter dans les lots de correction (sans les « résoudre » ici) :
- mass assignment prestataire ;
- audit falsifiable ;
- provenance de message falsifiable ;
- approbations mutables ;
- transitions métier contournables.

### 6.3 Privilèges et confiance

- Privilèges minimaux par table (cf. migration `20500`).
- Aucune confiance dans les identifiants reçus du navigateur (`user_id`, `prestataire_id`, montants, états).
- Écritures d'audit, d'agent et d'intégration réservées aux primitives de confiance.
- Fonctions `SECURITY DEFINER` : `search_path` explicite obligatoire.

### 6.4 Données de paiement
Références Stripe uniquement — jamais de carte / IBAN bruts.

### 6.5 Rétention et RGPD

**`[VALIDATION RESTANTE]`** Durées par catégorie (preuves financières, autorisations, audit, conversations, comptes). Le délai de prescription commerciale (cf. 01 §4) n'est **pas** la durée par défaut de tout le reste. Suppression/export de compte : format, délai, isolement des preuves encore requises.

### 6.6 Mode dégradé Stripe

**Ne jamais écrire qu'une tentative financière est simplement rejouée.**

Seule une **intention d'exécution** peut être mise en attente. Avant tout nouvel appel Stripe, recalculer :
- état de la créance ;
- solde ;
- autorisation ;
- litige ;
- limites ;
- idempotency key ;
- validité temporelle (et éligibilité Connect).

Une requête Stripe au **résultat ambigu** ne doit **jamais** être rejouée aveuglément.

Email / IA : files d'attente visibles ; workers déterministes indépendants de la disponibilité du modèle.

### 6.7 Opérations transverses (cible)

- Séparation stricte **local / staging / production** (clés, projets Supabase, Stripe, redirects).
- Headers de sécurité et **CSP**.
- Validation bornée (Zod) sur tous les inputs — tailles, formats, allowlists.
- **Readiness** stricte (`/api/health` et contrôles associés sans fuite de secrets).
- Sauvegarde et **réponse à incident** documentées dans `docs/operations/` (runbooks) — le document 03 impose l'exigence, pas le détail opérationnel.

---

## 7. Workers et tâches planifiées (cron)

**Clarification verrouillée :** les workers déclenchent l'**envoi actif** ou la préparation d'intentions — jamais la création automatique d'une session Stripe payable sur une créance dont le compte n'est pas payable. Un client ne peut payer tôt que si un lien **partageable** lui a été exposé (compte payable).

- **Scanner de prévention** (quotidien) : créances ouvertes / partiellement réglées dans la fenêtre J-5 → `dossier_suivi` `PRÉVENTION` → notice si non déjà envoyée.
- **Scanner d'échéance** (quotidien) : échéance atteinte → `ÉCHÉANCE` → envoi actif du lien **uniquement si partageable** (payable) et règles OK — ne change pas `creance.etat`.
- **Scanner de paiements automatiques** (quotidien) : checklist §4 → intention / `tentative_paiement` `prelevement_auto` — pas de modification directe de `creance.etat`.
- **Gestionnaire de tentative échouée** (webhook) : selon `retry_policy` (none au MVP) — jamais replay ambigu.
- **Scanner de silence prolongé** (quotidien) : escalade humaine selon `regle` — jamais `IRRECOUVRABLE` automatique.
- **Scanner de clôture** (quotidien) : `CLOS` lorsque créance terminale, après communications admin nécessaires.

---

## 8. Observabilité

- Taux de succès des webhooks acquis et traités.
- Latence événement Stripe → transition d'état.
- Volume messages agent (registre libre vs encadré) et coûts IA.
- Alerte sur tentative de transition contournant un garde-fou.
- Métriques Auth (échecs signup/login génériques, rate limits) — sans PII.
- *(Rapprochement bancaire : hors MVP, §12.)*

Logs : pas de secrets, pas de mots de passe, pas de prompts complets ni de contenu sensible (cf. §10).

---

## 9. Questions techniques ouvertes

**`[VALIDATION RESTANTE]`**
1. Statut PDP / facturation électronique — hors impact MVP strict.
2. Poids relatif LLM vs règles pour la détection de litige.
3. Calibrage retry après données Stripe réelles.
4. Durées de conservation précises (§6.5).
5. Format/délai suppression-export compte.
6. Détail mode dégradé par fournisseur.
7. Prénotification SEPA (§5.3) : responsabilités exactes Stripe vs Sidian.
8. Champs minimaux Connect France pour `charges_enabled` (cf. 02 §4.2).

*(Agrégation bancaire : §12.)*

---

## 10. Système IA — abstraction contrôlée (01 P9/P10)

**Principe :** aucun appel au modèle par nom dans le domaine métier. Point de passage unique serveur.

```ts
type ModelProfile =
  | "classification"
  | "conversation"
  | "reasoning";

type AITask =
  | "classify_message"
  | "draft_notice"
  | "draft_reminder"
  | "summarize_thread"
  | "detect_dispute_signal";

interface AIRequest<TInput, TOutput> {
  profile: ModelProfile;
  task: AITask;
  input: TInput;
  outputSchema: ZodSchema<TOutput>;
  tenantContext: {
    prestataireId: string;
    requestId: string;
  };
}

interface AIResponse<T = unknown> {
  structuredOutput: T;
  provider: string;
  model: string;
}
```

**Contraintes non négociables :**
- prompts système sélectionnés **côté serveur** dans un registre versionné — **aucun** `systemPrompt` fourni par le navigateur ;
- sorties structurées obligatoires pour les intentions métier ;
- données minimisées ; limites de taille ; timeout ; quota et budget ;
- allowlist d'outils ;
- **aucune exécution financière directe** par le modèle ;
- kill switch global et par prestataire ;
- aucune donnée cross-tenant ;
- logs sans prompt complet ni contenu sensible.

Le modèle renvoie une **intention structurée**, validée par une fonction métier déterministe avant toute exécution. Registre encadré → `approval_request`, jamais exécution directe.

Organisation recommandée :

```
src/
├── ai/
│   ├── run-ai.ts
│   ├── model-profiles.ts
│   ├── prompt-registry/
│   ├── tasks/
│   └── schemas/
├── domain/
├── services/
└── audit/
```

---

## 11. Assistants externes (Claude, ChatGPT) et MCP — backlog

Vrai dès aujourd'hui sans construction supplémentaire :
- logique métier indépendante du fournisseur IA (P9) ;
- aucun modèle n'écrit directement dans Stripe ou Supabase ;
- même chemin de contrôles et d'audit pour tout acteur (P10).

**Repoussé** jusqu'à besoin utilisateur réel : serveur MCP, bus générique, multi-fournisseurs, event sourcing, microservices, etc.

Test de validation futur : même intention → même fonction métier → mêmes contrôles → même trace.

---

## 12. Architecture différée — MVP+1 (agrégation bancaire)

Rien ici n'est développé au MVP.

Futur probable :
- flag d'agrégation lecture seule sur `prestataire` ;
- entité `evenement_bancaire` ;
- moteur de rapprochement prudent (ambigu → manuel) ;
- worker d'import ;
- métrique de taux de rapprochement.

**Contrainte :** accès strictement lecture seule — jamais de scope d'écriture bancaire.

**Au MVP :** aucun paiement hors Sidian n'est détecté automatiquement. Si le produit retient une **déclaration manuelle** (`declare_manuellement_hors_sidian` — `[MIGRATION À PRÉVOIR]`), elle est une commande serveur auditée, distincte de `detecte_hors_sidian` (valeur d'enum actuelle non utilisée pour l'auto-détection).

---

## 13. Inventaire du code existant — méthode de tri

Une seule question par brique : dépend-elle du modèle abandonné (enrôlement obligatoire, séquence J0/J5/J9/J10, contrat central, grille Starter/Pro/Business) ?
- **Dépend → réécrire.**
- **Neutre → conserver après revue** (auth, design system, infra).
- **À évaluer :** intégrations legacy facturation — uniquement si découplables en `reference_externe`.

Le legacy documentaire n'est **jamais** une source de règle active.

---

*Document 03 sur 3 — V2. Voir 01 · Fondations (P9/P10) et 02 · PRD.*
