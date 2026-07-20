# SIDIAN — 03 · ARCHITECTURE TECHNIQUE (V2)
## Modèle de données, machines d'état, intégrations — le comment, jamais le pourquoi

**Statut :** document purement technique. Toute justification produit ou métier renvoie à 02 (PRD) ; toute justification de contrainte externe renvoie à 01 (Fondations). Réécrit intégralement le 14 juillet 2026 ; réaligné le 16 juillet 2026 sur le schéma MVP appliqué (migrations `2026071512*`), la phase Auth et les invariants de sécurité cibles ; réaligné le 19 juillet 2026 (première passe) sur le lien préparé/payable/partageable, Express/Checkout, Customer binding, URL de paiement, canaux WhatsApp/SMS, pricing, signal « prêt à communiquer » ; corrigé le 19 juillet 2026 (seconde passe) sur la contradiction Connect/onboarding, la définition currently_due/future_requirements, le parcours setup pour l'autorisation future, le statut payment_link (active/revoked seul), et la projection des exigences Stripe ; verrouillé le 19 juillet 2026 (troisième passe) sur la liste explicite des webhooks, les identifiants Stripe de rapprochement (`stripe_checkout_session_id`, `stripe_setup_intent_id`, `stripe_setup_checkout_session_id`), les contraintes SQL de `payment_link`/`stripe_customer_binding`, et la reformulation prudente du parcours setup ; figé le 19 juillet 2026 (quatrième passe, documentaire) sur le cycle de vie active/superseded de `stripe_customer_binding` et la transition explicite `checkout.session.expired` → `ANNULEE` ; verrouillé le 19 juillet 2026 (cinquième passe, finale) sur la nullabilité conditionnelle de `payment_authorization` et l'état `EXPIRÉE` distinguant session de paiement et session `setup` expirées ; complété le 19 juillet 2026 (sixième passe, invariants finaux) sur la portée relationnelle de l'autorisation, les transitions documentées, la rotation irréversible des liens, la suspension complète en litige, l'isolation Customer, les webhooks inconnus et l'EUR exclusif au MVP.

**Stack conservée :** Next.js / Supabase (Postgres + RLS) / Stripe Connect. Développement Cursor.

**Convention de marquage :**
- champs et contraintes **présents dans les migrations actives** : décrits sans marqueur ;
- écarts nécessitant une évolution de schéma : **`[MIGRATION À PRÉVOIR]`** ;
- points dépendant d'une confirmation externe : **`[VALIDATION RESTANTE]`**.

---

## 1. Modèle de données — entités et champs clés

**Note de vocabulaire :** `creance` est un nom d'entité interne. Il n'apparaît jamais tel quel dans l'interface ou la communication vue par le prestataire ou le client — le terme produit est « paiement à recevoir » (cf. 02, §1). Toute chaîne de caractères destinée à l'affichage doit utiliser le vocabulaire produit, jamais le nom de la table.

**Périmètre :** les entités ci-dessous sont celles du MVP tel que scopé en 02 §8. Tout ce qui relève de l'agrégation bancaire est délibérément absent d'ici et regroupé en §12 (Architecture différée).

**Réalité schéma (20 juillet 2026) :** 17 tables versionnées dans `supabase/migrations/` — les 13 tables métier initiales, `stripe_customer_binding`, `payment_link`, `stripe_webhook_effect` et `stripe_connect_audit_outbox`.

### `prestataire`

**Champs présents (migrations actives) :**
`id`, `user_id` (uuid, **unique**, FK `auth.users`, `on delete restrict` — un utilisateur Auth = un prestataire au MVP), `nom`, `email`, `subscription_status` (`trialing` / `active` / `past_due` / `cancelled`), `pricing_version` (texte — **[DÉCISION]** toute valeur historique non vide est conservée telle quelle afin de préserver sa provenance ; `early_solo` est uniquement la valeur par défaut des nouveaux comptes ; aucune reclassification automatique vers une offre active n'est autorisée sans migration produit explicitement documentée — le prix commercial affiché n'est jamais encodé dans l'identifiant technique), `subscription_started_at` (nullable), `early_access_price_locked_until` (nullable — s'applique désormais à un verrouillage à vie pour les 30 premiers comptes, pas à une fenêtre de 12 mois), `profil_agent_defaut` (`controle` / `delegation`), `platform_fee_basis_points` (integer ≥ 0, défaut 0), `created_at`.

**Projection Stripe Connect — présente depuis SID-STRIPE-001 :**
- `stripe_account_id` (nullable)
- `stripe_charges_enabled` (bool)
- `stripe_payouts_enabled` (bool, si nécessaire)
- `stripe_details_submitted` (bool)
- `stripe_onboarding_status` (texte normalisé, dérivé des champs Stripe ci-dessous — ex. `non_commence` / `configuration_commencee` / `informations_requises` / `verification_en_cours` / `paiements_actives` / `paiements_indisponibles` / `action_requise`, cf. 02 §2bis pour le mapping produit)
- `stripe_requirements_currently_due` (jsonb ou texte, liste normalisée)
- `stripe_requirements_pending_verification` (jsonb ou texte)
- `stripe_requirements_past_due` (jsonb ou texte)
- `stripe_disabled_reason` (nullable, texte)
- `stripe_status_synced_at` (timestamptz)

Ne pas nécessairement stocker les tableaux Stripe complets tels quels — une projection compacte normalisée suffit pour piloter l'affichage produit. **Les Account Links sont à usage unique** : l'utilisateur doit pouvoir être renvoyé dans un nouveau flux dès que de nouvelles exigences apparaissent, détectées via webhook `account.updated` plutôt que supposées stables après la première visite.

**Stripe reste la source externe de vérité.** La base conserve uniquement une **projection locale synchronisée** (webhooks + revérifications serveur). `stripe_charges_enabled` n'est **jamais** une « source de vérité unique » : c'est un cache local. Une revérification Stripe live est obligatoire avant toute action critique (création de session payable, envoi d'un lien partageable, tentative `prelevement_auto`, passage d'un compte à « payable » côté produit).

**Invariant unique de décision Stripe [DÉCISION].** La projection locale sert uniquement à l'affichage produit, au diagnostic et à éviter des appels inutiles. Toute décision financière ou toute exposition d'une capacité de paiement repose sur une revérification Stripe live au moment de l'action ; aucun cache local, même récemment synchronisé, ne peut autoriser seul une opération financière.

**Le prix commercial n'est jamais utilisé comme logique métier** dans le suivi des paiements. Aucun quota d'utilisateurs, de clients ou d'automatisation lié à un plan n'est codé au MVP.

**Opérateur unique au MVP :** un compte `prestataire` possède un seul utilisateur principal via `user_id` — aucune architecture RBAC.

**Onboarding (SID-SEC-001 — corrigé localement) :** création via RPC `ensure_prestataire_for_current_user(p_nom)` ; mise à jour du nom via `update_current_prestataire_name(p_nom)` ; aucun INSERT/UPDATE/DELETE PostgREST `authenticated` sur `prestataire` ; ACL `authenticated` = **SELECT uniquement** (MAINTAIN révoqué). Email stocké sous forme canonique `lower(btrim(auth.users.email))` (réconciliation si `IS DISTINCT FROM`) ; champs commerciaux et `created_at` immuables côté client.

### Lien de paiement — préparé / payable / partageable

Formalisation technique (traduction et correction de 02 §4.2) :

1. La **créance** est créée.
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

**Signal « prêt à communiquer » — présent depuis SID-STRIPE-001 :** `ready_for_collection_at` (nullable, timestamptz), renseigné par la commande `mark_creance_ready_for_collection`. Jamais renseigné par une déduction autonome du LLM.

### `tentative_paiement` — essai, pas règlement confirmé
`id`, `creance_id` (FK), `montant` (bigint > 0), `moyen` (`carte` / `sepa_core`), `source` (`lien_agent` / `prelevement_auto`), `stripe_payment_intent_id` (nullable, unique si non null), `etat` (cf. §2.2), `echec_code` (nullable), `echec_message` (nullable), `created_at`.

`stripe_checkout_session_id` (nullable, unique si non null) permet à `checkout.session.completed` de retrouver directement la tentative concernée sans dépendre uniquement des métadonnées.

**Toute tentative, y compris échouée, crée une ligne ici — jamais dans `paiement`.** Authenticated : lecture seule (pas d'INSERT navigateur).

### `paiement` — règlements confirmés uniquement
`id`, `creance_id` (FK), `tentative_paiement_id` (FK nullable, unique si non null), `montant` (bigint > 0), `source`, `created_at`.

**Sources MVP :** `lien_agent`, `prelevement_auto`.

**Enum actuelle** contient aussi `detecte_hors_sidian` (migrations). **Hors périmètre produit MVP** — réservé à l'architecture différée (§12). Ne pas l'utiliser pour une détection automatique. Si une déclaration manuelle hors plateforme est retenue produit : introduire `declare_manuellement_hors_sidian` **`[MIGRATION À PRÉVOIR]`** (remplacement / ajout d'enum), avec écriture uniquement via commande serveur auditée — jamais via agrégation bancaire.

Trigger de scope : si `tentative_paiement_id` est renseigné, il doit référencer la même `creance_id`. Authenticated : lecture seule.

### `payment_authorization`
`id`, `client_payeur_id` (FK), `prestataire_id` (FK), `type` (`card_off_session` / `sepa_core_mandate` — **nullable tant que `etat = EN_CONFIGURATION`**, la Checkout Session `setup` n'a pas encore révélé le moyen choisi), `stripe_payment_method_id` (**nullable tant que `etat = EN_CONFIGURATION`**, aucun PaymentMethod n'existe avant le succès du SetupIntent), `stripe_mandate_id` (nullable), `etat` (cf. §2.3), `is_default` (bool), `authorized_at` (**nullable tant que `etat ≠ ACTIVE`**), `authorization_text_version`, `authorization_channel`, `revoked_at` (nullable), `created_at`.

**Contraintes SQL progressives [DÉCISION SID-STRIPE-001-FIX] — compatibles avec une base peuplée :**
```
etat = ACTIVE implique :
  - type IS NOT NULL
  - stripe_payment_method_id IS NOT NULL
  - authorized_at IS NOT NULL
  - authorization_text_version non vide
  - authorization_channel non vide
  - revoked_at IS NULL

etat = REVOQUEE implique :
  - revoked_at IS NOT NULL

type = sepa_core_mandate ET etat = ACTIVE implique :
  - stripe_mandate_id IS NOT NULL, lorsque Stripe expose un mandat distinct applicable
```
Ces contraintes sont ajoutées `NOT VALID` : elles protègent les nouvelles écritures et mutations, mais aucune ligne historique incompatible n'est artificiellement déclarée conforme. Le diagnostic agrégé précède toute validation ultérieure. La contrainte de mandat distinct reste à adapter au comportement réel de Stripe ; l'autorisation ne peut en aucun cas exiger un `stripe_payment_method_id` avant que le SetupIntent ait réussi.

`stripe_setup_intent_id` (nullable, unique si non null) et `stripe_setup_checkout_session_id` (nullable, unique si non null) permettent le rapprochement idempotent du parcours `setup`.

**Règles d'idempotence (rapprochement Stripe) :**
- une Checkout Session de paiement correspond à une seule `tentative_paiement` ;
- une Checkout Session `setup` et son SetupIntent correspondent à une seule `payment_authorization` ;
- les métadonnées Stripe transmises contiennent uniquement les identifiants internes minimaux nécessaires (ex. `creance_id`, `payment_authorization_id`), jamais de donnée sensible ;
- tout identifiant reçu par webhook est systématiquement recoupé avec le compte connecté attendu (cf. §5.2).

Contraintes actives :
- index unique partiel : au plus une `is_default` par couple `(client_payeur_id, prestataire_id)` ;
- **`is_default = true` implique `etat = ACTIVE`** (`payment_authorization_default_requires_active`) ;
- trigger de scope client × prestataire.

**Portée métier de l'autorisation [DÉCISION].** Une `payment_authorization` autorise les futurs paiements éligibles entre un `client_payeur` et un `prestataire` ; elle n'est pas rattachée à la seule créance ou au seul paiement ayant déclenché sa proposition. Un remboursement, une annulation ou une dispute ultérieure du premier paiement ne la révoque pas automatiquement.

Le remplacement d'une autorisation par défaut doit être **transactionnel** : l'ancienne autorisation conserve son historique et son état propre mais passe à `is_default = false`, puis la nouvelle autorisation `ACTIVE` passe à `is_default = true` dans la même transaction. Aucune fenêtre ne doit permettre deux autorisations par défaut, ni zéro autorisation par défaut si l'opération était censée réussir atomiquement. Authenticated : lecture seule au MVP.

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

### `stripe_customer_binding` — mapping Customer Stripe

`id`, `prestataire_id` (FK), `client_payeur_id` (FK), `stripe_account_id`, `stripe_customer_id`, `status` (`active` / `superseded`), `superseded_at` (nullable), `created_at`, `updated_at`.

**Contraintes SQL à verrouiller [DÉCISION — corrige la contradiction entre la contrainte unique et le remplacement de compte] :**
- `UNIQUE (stripe_account_id, stripe_customer_id)`
- `UNIQUE PARTIEL (prestataire_id, client_payeur_id) WHERE status = 'active'` — remplace l'unicité stricte précédente, incompatible avec la conservation d'un ancien binding lors d'un remplacement de compte Connect.

**Remplacement de compte Connect [DÉCISION] :** ne jamais écraser silencieusement un binding existant. Avec des direct charges, le compte connecté est le merchant of record — Customers et PaymentMethods lui appartiennent. Si un compte Connect doit être remplacé pour un prestataire, c'est une **opération administrative contrôlée** : le binding existant passe à `superseded` (`superseded_at` renseigné), une nouvelle ligne `active` est créée — jamais un UPDATE qui écrase l'ancien identifiant Stripe. Ainsi un seul binding actif existe par couple prestataire/client, l'historique reste intact pour l'audit, et aucun identifiant Stripe historique n'est perdu.

Contraintes : cohérence stricte entre `prestataire_id`, `client_payeur_id` et le compte connecté (même principe que le §5.2) ; aucune écriture navigateur, création/mutation par primitive serveur uniquement ; les Customers sont créés dans le scope du compte connecté ; aucun Customer Stripe n'est réutilisable entre deux prestataires.

Avant tout binding, le Customer est relu dans le compte Connect dérivé du prestataire et doit porter exactement `sidian_prestataire_id`, `sidian_client_payeur_id` et `sidian_environment`. Un Customer supprimé, sans métadonnées ou avec une valeur différente est refusé.

La rotation est ensuite exécutée par `replace_verified_stripe_customer_binding`, accessible uniquement au rôle PostgreSQL `stripe_customer_binding_writer` (`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`) endossé par `authenticator` depuis un JWT serveur pré-généré. `service_role` conserve uniquement la lecture de diagnostic : il ne peut ni appeler cette RPC, ni muter directement `stripe_customer_binding`. Le JWT porte `sidian_environment`, possède une expiration bornée et reste distinct entre les projets Supabase local, staging et production.

**Invariant d'identité [DÉCISION].** Un `Stripe Customer` n'est jamais assimilé au client produit globalement. Un même `client_payeur` — y compris avec le même email — peut et doit posséder un Customer Stripe distinct dans chaque compte Connect de prestataire. Aucun rapprochement cross-prestataire n'est autorisé sur la seule base de l'email, du nom ou d'un identifiant Stripe provenant d'un autre compte connecté.

### `payment_link` — URL publique opaque

`id`, `creance_id` (FK), `token_hash`, `status` (**[DÉCISION — corrige l'ambiguïté précédente]** `active` / `revoked` uniquement — jamais `prepared` ni `payable` ni `partageable` comme statut stocké, ces qualités dépendent de l'état Stripe qui peut changer à tout moment et ne doivent jamais devenir des données périmées en base), `revoked_at` (nullable), `created_at`, `updated_at`.

**Contraintes SQL à verrouiller :**
- `UNIQUE PARTIEL (creance_id) WHERE status = 'active'` — un seul lien actif par paiement à recevoir, tout en conservant les anciens liens révoqués pour l'historique et l'audit.
- `UNIQUE (token_hash)`.
- `CHECK` : `revoked_at IS NOT NULL` si `status = revoked` ; `revoked_at IS NULL` si `status = active`.

**Lecture métier, calculée dynamiquement à chaque accès, jamais lue depuis une colonne de statut figée :**
- **Préparé** : `payment_link.status = active`, mais compte Stripe non payable (revérification live).
- **Payable** : calcul serveur dynamique après revérification Stripe (`charges_enabled` + éligibilité pour ce montant/rail) — jamais un booléen mis en cache sans revérification avant action critique (cf. §1, projection `prestataire`).
- **Partageable** : `payment_link.status = active` **et** créance éligible **et** compte payable confirmé au moment de l'exposition.
- **Révoqué** : `payment_link.status = revoked` — lien inutilisable, quelle que soit l'éligibilité Stripe.

Règles non négociables : token aléatoire, opaque, non prédictible ; stocké uniquement sous forme d'empreinte (`token_hash`), jamais en clair ; `creance_id` jamais exposé directement dans l'URL publique ; une URL active génère des sessions Stripe fraîches à la demande, jamais une session stockée comme lien durable ; aucune session payable si le compte Connect n'est pas payable ; validation serveur du token, de la créance, du prestataire et du compte Stripe à chaque ouverture ; rate limiting sur l'endpoint public.

**Rotation irréversible [DÉCISION].** Un lien révoqué ne repasse jamais à `active` et son token reste définitivement inutilisable. Recréer un lien pour la même créance implique l'insertion d'une nouvelle ressource `payment_link` avec un nouveau token opaque et une nouvelle empreinte ; l'ancienne ligne demeure `revoked` pour l'historique.

### `processed_webhook_event` — état actuel vs cible

**Schéma SID-STRIPE-001-FIX :**
- `id`
- `type`
- `stripe_connected_account_id` (nullable / text)
- `received_at`
- `processing_status`
- `processing_attempts`
- `processed_at` (nullable)
- `last_error_code` (nullable)
- `lease_expires_at` (nullable)
- `lease_token` (nullable, UUID non réutilisable)
- `next_attempt_at` (nullable)

`processing_status` distingue `received`, `processing`, `processed`, `ignored`, `failed_retryable` et `failed_terminal`.

Chaque claim réussi remplace `lease_token`. Renouvellement et transition finale exigent `(event_id, lease_token, processing_attempts)` et un lease non expiré. Le plafond est de 8 tentatives ; son dépassement produit `failed_terminal` / `webhook_max_attempts_exceeded`. Les erreurs sont classées `retryable`, `terminal` ou `lease_lost` ; un worker ayant perdu son lease ne réécrit aucun statut.

### `stripe_webhook_effect`

Registre transactionnel des effets métier, unique sur `(stripe_event_id, stripe_object_id, effect_type)`. Pour `account.updated`, la RPC verrouille `processed_webhook_event` et exige le token, la tentative et le lease courant avant toute écriture. Un worker périmé ne consomme donc pas la clé d'effet et ne projette rien. Le worker courant réapplique toujours la projection Stripe live, même si le registre existe déjà, tout en conservant son unicité. Cette réapplication est réservée aux projections idempotentes ; elle ne doit jamais être généralisée automatiquement aux futurs effets financiers.

### `stripe_connect_audit_outbox`

Preuve durable créée dans la même transaction que la finalisation locale Connect. Une livraison idempotente vers `audit_log` peut être reprise après panne ; le verrou de ligne empêche tout doublon sous concurrence.

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
NON_PROPOSÉE → PROPOSÉE → EN_CONFIGURATION
                                  ├──► ACTIVE
                                  ├──► REFUSÉE
                                  └──► EXPIRÉE
ACTIVE → RÉVOQUÉE | EXPIRÉE | SUSPENDUE → ACTIVE | RÉVOQUÉE
```

**`EXPIRÉE` en sortie de `EN_CONFIGURATION` `[MIGRATION À PRÉVOIR]`** — distinct de `REFUSÉE` : un refus est une décision explicite du client sur l'écran Stripe, une expiration est un parcours abandonné ou une Checkout Session `setup` arrivée à expiration sans action. Les deux laissent l'autorisation hors `ACTIVE`, mais la distinction reste utile pour l'agent (relancer une expiration silencieuse diffère de respecter un refus exprimé) et pour le diagnostic produit.

**Causes de transition [DÉCISION] :**
- `EN_CONFIGURATION → ACTIVE` : SetupIntent confirmé et moyen/mandat utilisable ;
- `EN_CONFIGURATION → REFUSÉE` : refus explicite du client ;
- `EN_CONFIGURATION → EXPIRÉE` : parcours abandonné ou Checkout Session `setup` expirée ;
- `ACTIVE → SUSPENDUE` : moyen détaché ou temporairement inutilisable, mandat invalide, litige nécessitant un gel, ou garde-fou produit ;
- `SUSPENDUE → ACTIVE` : cause de suspension résolue et validité Stripe revérifiée, ou nouveau moyen correctement enregistré ;
- `ACTIVE | SUSPENDUE → RÉVOQUÉE` : révocation explicite du client ou événement Stripe terminal ;
- `ACTIVE → EXPIRÉE` : moyen ou mandat arrivé à expiration sans remplacement utilisable.

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
2. Claim **atomique** de l'événement avec contrainte unique sur `id`, lease et compteur de tentatives.
3. Un terminal `processed` / `ignored` / `failed_terminal` est acquitté 200 sans retraitement.
4. Un `failed_retryable` arrivé à échéance ou un `processing` au lease expiré peut être réclamé par un seul worker.
5. Toute transition et tout renouvellement sont fenced par le token et le numéro de tentative.
6. Une livraison concurrente non terminale reçoit un non-2xx afin que Stripe retente.
7. Les retries sont bornés (8) et les raisons terminales sont normalisées pour l'exploitation.
8. Toute écriture de statut est contrôlée ; une panne non persistée ne reçoit jamais 200.
9. Tout type inconnu devient terminal `ignored` sans transition métier ni effet de bord.

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

**[DÉCISION — type de compte rendu explicite]** Compte connecté de type **Express**, sauf incompatibilité technique démontrée à l'implémentation. Direct charges. Le prestataire est merchant of record ; les objets financiers Stripe (Customer, PaymentMethod, Mandate, PaymentIntent) appartiennent au scope du compte connecté, jamais à la plateforme. Sidian guide l'utilisateur via sa propre interface autour de ce compte, mais les étapes sensibles de vérification d'identité et de compte bancaire restent hébergées ou sécurisées par Stripe — Sidian ne recrée pas ces écrans réglementaires au MVP.

Commission via `application_fee_amount` / `platform_fee_basis_points` (**0** pendant Early Access).

**Devise MVP [DÉCISION].** Toute l'intégration Stripe du MVP est strictement en EUR : créances, Checkout Sessions de paiement, PaymentIntents, montants de commission et rapprochements financiers utilisent `eur`. Les Checkout Sessions en mode `setup` n'encaissent pas de montant, mais les moyens configurés ne sont utilisés au MVP que pour des paiements futurs en EUR. Toute ouverture multi-devise exige une décision produit et une évolution explicite du domaine, jamais un simple paramètre Stripe ajouté localement.

**Interface de paiement client [DÉCISION — corrige la mention précédente] :** Stripe Checkout hébergé pour le premier paiement (carte + SEPA Core) — pas de Payment Element ni de formulaire de carte/IBAN construit par Sidian au MVP. Toute opération sensible (paiement, ajout/modification d'un moyen de paiement) passe par les écrans Stripe. Sidian peut envisager une expérience de paiement entièrement intégrée plus tard, hors périmètre MVP. Aucun masquage d'un rail (carte ou SEPA) sur la seule base d'un seuil de montant Sidian (cf. 02 §4.3).

### 5.1bis Parcours technique de l'autorisation future — Checkout Session en mode setup

**[DÉCISION]** Après le retour du premier Checkout (paiement), Sidian affiche la proposition d'autorisation (cf. 02 §4.4) indépendamment de l'état de confirmation du paiement initial. Si le client accepte, Sidian crée une **nouvelle Checkout Session Stripe en mode `setup`**, distincte de la session de paiement initiale. **[REFORMULÉ — ne pas garantir plus que ce que Stripe assure réellement]** Cette session permet au client de configurer le moyen destiné aux futurs paiements. Lorsque Stripe permet de réafficher le moyen précédemment utilisé et que le consentement approprié a été recueilli pendant le premier Checkout, celui-ci peut être proposé ; le client conserve toujours la possibilité de choisir un autre moyen compatible — la réutilisation transparente du moyen initial n'est jamais présentée comme garantie, elle dépend du rattachement du PaymentMethod au même Customer Stripe, de son enregistrement pendant le premier Checkout, du consentement recueilli, et des paramètres Checkout utilisés. Le `payment_authorization.etat` ne passe à `ACTIVE` que sur confirmation fiable du SetupIntent ou du mandat correspondant (webhook), jamais sur la seule fin du parcours Checkout de la session `setup`.

**`[DÉCISION — liste verrouillée, pas de choix laissé à l'implémentation]`** Webhooks Stripe à écouter au MVP :

```
account.updated
checkout.session.completed
checkout.session.expired
payment_intent.processing
payment_intent.succeeded
payment_intent.payment_failed
setup_intent.succeeded
setup_intent.setup_failed
payment_method.detached
mandate.updated
charge.dispute.created
```

Responsabilité de chacun :
- `account.updated` : rafraîchit la projection Stripe du prestataire (§1) — jamais utilisé seul pour autoriser une action critique sans revérification live.
- `checkout.session.completed` : rattache le parcours terminé à la `tentative_paiement` (paiement) ou `payment_authorization` (setup) via `stripe_checkout_session_id` / `stripe_setup_checkout_session_id` — **ne confirme jamais seul un paiement SEPA** (cf. §5.1bis, 02 §4.4).
- `checkout.session.expired` : **si la session est une session de paiement** (`stripe_checkout_session_id` sur `tentative_paiement`), `tentative_paiement` → `ANNULEE` (pas d'état `EXPIREE` dans la machine §2.2), ne modifie jamais `creance.etat` directement. **Si la session est une session `setup`** (`stripe_setup_checkout_session_id` sur `payment_authorization`), l'autorisation reste hors `ACTIVE` et passe de `EN_CONFIGURATION` à `EXPIRÉE` (§2.3) — jamais considérée comme autorisée, distincte d'un refus explicite.
- `payment_intent.processing` : `tentative_paiement` → `EN_TRAITEMENT`.
- `payment_intent.succeeded` : `tentative_paiement` → `RÉUSSIE`, création idempotente de `paiement`, recalcul de l'état de la créance.
- `payment_intent.payment_failed` : `tentative_paiement` → `ÉCHOUÉE` (`echec_code`/`echec_message`), sans modifier directement l'état financier de la créance.
- `setup_intent.succeeded` : activation transactionnelle de `payment_authorization` (`EN_CONFIGURATION` → `ACTIVE`).
- `setup_intent.setup_failed` : `payment_authorization` reste hors `ACTIVE`, erreur normalisée journalisée.
- `payment_method.detached` : suspension ou expiration de l'autorisation concernée si elle référence ce moyen.
- `mandate.updated` : réévaluation de l'état de l'autorisation SEPA concernée (ex. mandat révoqué côté banque).
- `charge.dispute.created` : procédure prudente déjà documentée ci-dessus (litiges).

Le SEPA reste un moyen à confirmation différée : c'est le `PaymentIntent` qui pilote ses états jusqu'à confirmation finale — la fin du Checkout ne signifie jamais que les fonds sont disponibles.

**Traitement de `charge.dispute.created` [DÉCISION — règles de non-régression] :** ne jamais supprimer ou réécrire un `paiement` déjà confirmé ; ne jamais faire repasser automatiquement une créance terminale `REGLEE` vers un état improvisé ; créer une trace d'audit rattachée au prestataire, au client, à la tentative et au paiement concernés lorsque résolvable ; suspendre les nouvelles tentatives `prelevement_auto` pour l'autorisation concernée et toute relance automatique de l'agent sur le dossier le temps du litige ; placer le dossier en `ESCALADE_HUMAINE` ; afficher clairement au prestataire qu'un litige Stripe est en cours. Les communications nécessaires à la résolution restent possibles uniquement sous contrôle humain. **`[MIGRATION À PRÉVOIR]`** si un objet dédié est nécessaire pour la gestion comptable complète (reversals, remboursements, pertes) — proposition : `payment_dispute` — sans surcharger `creance.etat` pour ce besoin.

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

**Réconciliation du provisioning Connect.** Les comptes créés portent les métadonnées serveur stables `sidian_prestataire_id`, `sidian_environment` et `sidian_provisioning_operation_id`. Une reprise parcourt toutes les pages Stripe et collecte tous les comptes portant l'identifiant d'opération. Zéro résultat autorise une création avec l'idempotency key persistée ; un résultat est réutilisé seulement s'il est Express, français, non supprimé, contrôlé par l'application avec collecte Stripe et Dashboard Express, dans le bon tenant et environnement ; plusieurs résultats, un compte incompatible ou déjà rattaché à un autre prestataire produisent un échec terminal opérable.

### 5.3 SEPA Core — prénotification

**[DÉCISION MVP — formulation prudente]** Au MVP, Sidian s'appuie sur les mécanismes de notification SEPA fournis par Stripe lorsque la configuration utilisée le permet, plutôt que de construire un moteur complet de prénotification. Les éléments de preuve exposés par Stripe (événement, statut) sont journalisés (`audit_log` et/ou champs dédiés — `[MIGRATION À PRÉVOIR]` si champs manquants). La version du texte d'autorisation présenté par Sidian lui-même (le consentement à l'autorisation de paiement future, cf. `payment_authorization.authorization_text_version`) est distincte de la prénotification légale du prélèvement et déjà tracée.

**`[VALIDATION RESTANTE]`** Toute responsabilité complémentaire (qui envoie la prénotification si Stripe ne la couvre pas entièrement pour la configuration retenue, délai exact, blocage du débit en cas d'échec) doit être validée contre la configuration Stripe réelle avant activation en production du prélèvement automatique SEPA — ne pas présenter cette validation comme acquise avant implémentation réelle.

### 5.4 Outil de facturation tiers
Hors MVP. Lecture seule future pour `reference_externe` — jamais d'écriture dans l'outil tiers.

---

## 6. Sécurité

### 6.1 Invariants actifs (migrations / code)

- RLS sur toutes les tables applicatives exposées.
- Aucun accès `anon` métier (`REVOKE ALL` sur les 17 tables).
- Isolation tenant via JWT authenticated + `current_prestataire_id()` (`SECURITY DEFINER` + `search_path = public`).
- Triggers de scope cross-tenant (creance, authorization, conversation, approval, regle, paiement/tentative, audit).
- Immutabilité `message` et `audit_log` pour rôles ordinaires.
- Protection UPDATE des champs commerciaux sensibles `prestataire` côté `authenticated`.
- Tables financières / système (`tentative_paiement`, `paiement`, `payment_authorization`, `processed_webhook_event`) : pas d'écriture navigateur (SELECT seul ou aucun grant authenticated).
- `service_role` uniquement dans des modules `server-only` (jamais importable client).
- `stripe_customer_binding` : aucun DML direct par `service_role` ; rotation uniquement via le JWT de `stripe_customer_binding_writer`, après validation Stripe live.
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
- **Readiness Stripe** stricte : `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` est obligatoire. À `false`, le webhook retourne immédiatement `404`, sans lire la requête ni créer de client Stripe/Supabase, et un build générique est permis. À `true`, `SIDIAN_ENVIRONMENT`, mode, clés secrète/publiable, secret webhook et `SUPABASE_STRIPE_BINDING_WRITER_JWT` non expiré sont tous obligatoires et cohérents avec `local|staging|production`. Le build échoue sans ce contrat complet, sans afficher les secrets.
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
