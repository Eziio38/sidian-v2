# Sidian — Cursor Master File (UPDATED)

> ## ⚠️ DOCUMENT OBSOLÈTE — NE PLUS UTILISER COMME RÉFÉRENCE
> **Ce fichier a été remplacé le 14 juillet 2026.**
>
> Sidian a changé de modèle produit dans son ensemble : abandon de l'enrôlement carte obligatoire, de la séquence de relance figée J+0→J+17, de l'objet central "contrat"/facture, et de la grille tarifaire Starter/Pro/Business. Le nouveau modèle repose sur un paiement à recevoir (créance), un premier règlement volontaire par lien, une autorisation de paiement proposée après ce règlement, et un calendrier de communication configurable plutôt que figé.
>
> **La source de vérité unique est désormais, dans cet ordre :**
> 1. `/docs/SIDIAN_01_FONDATIONS_V2.md`
> 2. `/docs/SIDIAN_02_PRD_V2.md`
> 3. `/docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`
>
> Ce fichier est conservé en lecture seule pour archivage historique et compréhension de l'ancienne architecture Stripe Connect (direct charge, webhooks, idempotence) — dont certains éléments purement techniques restent une référence utile pour l'implémentation, à condition de ne jamais en déduire une règle métier active. Voir `AGENTS.md` pour le détail de ce qui est repris et de ce qui est abandonné.
>
> **Ne pas s'y fier pour : le flow d'enrôlement, la séquence de relance, la grille tarifaire, le vocabulaire produit, la définition de l'objet métier central.**

---

*Contenu original conservé ci-dessous pour référence historique et technique — ne plus mettre à jour.*

---

> ## 🔒 SOURCE DE VÉRITÉ UNIQUE DU PROJET SIDIAN *(historique — voir bannière ci-dessus)*
>
> **Ce fichier (`/SIDIAN_CURSOR_UPDATED.md`) est l'unique source de vérité fonctionnelle et technique du projet.**
>
> Il prévaut systématiquement sur :
> - le code applicatif existant ;
> - les migrations SQL existantes ;
> - les fichiers `README.md` ;
> - tout ancien cahier des charges ou plan de bloc (`docs/*`, `app/SIDIAN_CURSOR.md`, etc.) ;
> - tout audit, snapshot d'état projet ou rapport QA passé ;
> - tout prompt ou règle Cursor ;
> - tout commentaire de code.
>
> **Aucune décision structurante (règle métier, statut, modèle de charge Stripe, schéma de données, séquence de relance, politique de commission) ne doit être implémentée dans le code sans être documentée au préalable dans ce fichier.**
>
> En cas de contradiction entre ce fichier et n'importe quelle autre source : ce fichier prévaut toujours, sans exception. Toute contradiction détectée doit être signalée et corrigée ici avant de reprendre le développement.
>
> Cursor doit le lire intégralement avant chaque session de développement.

*Dernière mise à jour : 11 juillet 2026 — parcours manuel MVP, Pennylane OAuth B1.1, catalogue read-only B2a et architecture paiement inchangée*

---

## 1. Vision & Concept

Sidian est un SaaS B2B français qui élimine les factures impayées pour les freelances via un système de pré-autorisation bancaire et de relance automatique.

- Le freelance crée un "contrat" dans Sidian au début de chaque collaboration
- Le client enregistre son moyen de paiement une seule fois (carte via Stripe, OB via Fintecture en V2)
- Sidian surveille chaque échéance et propose un paiement en un clic dès J+0 si impayée
- Si le freelance signale un règlement externe reçu → Sidian n'agit plus, ne prend rien
- Si impayée : rappel J+0 (lien Stripe), relance J+5 (lien Stripe), confirmation freelance J+9, paiement automatique autorisé J+10
- La commission Sidian s'applique uniquement aux paiements Stripe réussis (liens J+0/J+5, débit J+10, retries) — jamais sur un virement externe

**Positionnement freelance :** *"Automatise tes paiements. Réduis tes impayés."*

**Positionnement client :** *"Activez votre collaboration. Vos paiements se font automatiquement."*

**Règle produit fondamentale — perception client :**
> Le client ne rejoint pas un système anti-impayé.
> Le client active une collaboration disposant d'un système de paiement simplifié.
> Le paiement est une composante de la collaboration, pas la finalité de l'enrollment.

**Ce que Sidian n'est pas :**
- Un établissement de paiement (Stripe et Fintecture sont les établissements agréés)
- Un outil de facturation
- Un outil de relance ou de pression
- Un outil d'affacturage
- Un prestataire détenant les données bancaires ou les fonds (Stripe exécute les paiements carte et SEPA)

**Méthode de paiement — règle MVP / bêta privée :**
> Stripe est l'unique provider de paiement actif. Les moyens actifs sont `card` et `sepa_debit` (SEPA Core).
> La carte reste présélectionnée et recommandée par défaut, sans seuil automatique par montant. Le client peut choisir le SEPA Direct Debit.
> Fintecture et Open Banking restent hors périmètre MVP. Voir §9 Méthode de paiement MVP.

---

## 2. Stack technique

| Couche | Outil | Notes |
|---|---|---|
| Framework | **Next.js 14** (App Router + TypeScript) | Front + API dans un repo, meilleur support LLM |
| Hébergement | **Vercel** | Zéro config avec Next.js |
| DB + Auth | **Supabase** | RLS natif, gratuit au MVP |
| Paiements carte et SEPA | **Stripe Connect** | Setup Intent + Payment Intent + application_fee |
| Open Banking | **Fintecture VRP** | V2 — fallback si carte échoue |
| Facturation FR | **Pennylane API v2** | Intégration optionnelle read-only — OAuth B1.1 + catalogue B2a (voir section 5) |
| Facturation FR | **Sellsy API v2** | V2 |
| Emails / SMS | **Brevo** | Séquences de relance, notifications |
| Emails transactionnels | **Resend** | Delivrability critique (reçus, alerts) |
| Crons / jobs | **Trigger.dev** | Surveillance échéances, séquence J+0 à J+10 |
| Validation | **Zod** | Sur tous les inputs sans exception |
| Code | **Cursor** | 20€/mois |

**Architecture :** Monorepo unique. Tout dans Next.js App Router. Pas de séparation front/back.

---

## 3. Grille tarifaire

| Plan | Abonnement | Commission |
|---|---|---|
| **Starter** | 0€/mois | 5% par facture impayée récupérée |
| **Pro** | 29€/mois | 2% par facture impayée récupérée |
| **Business** | 59€/mois | 0% |

**Logique :** La commission s'applique à **chaque paiement Stripe réussi initié depuis Sidian** (lien J+0, lien J+5, débit automatique J+10, retry réussi). Si le client règle par virement externe signalé et confirmé par le freelance → **0% de commission**. Sidian ne gagne sa commission que lorsqu'un PaymentIntent Stripe aboutit (`payment_intent.succeeded`). L'abonnement fixe maintient le filet actif en permanence.

**Commission acquise uniquement après :** `payment_intent.succeeded` — jamais à la création du PaymentIntent, jamais sur un paiement externe, jamais sur une tentative échouée ou en attente d'authentification.

**Seuils de rentabilité Starter (5%) :**

| Moyen de paiement | Seuil min | Marge à 300€ | Marge à 500€ |
|---|---|---|---|
| Carte standard EU | 8€ | +10,25€ | +17,25€ |
| Carte Corporate | 12€ | +5,30€ | +10,50€ |
| Open Banking | 6€ | +14,70€ | +24,70€ |

**Cible 2 000€ net/mois :** ~83 users (mix 50% Starter / 35% Pro / 15% Business)

---

## 4. Modèle de contrat (MVP)

**Principe fondamental du MVP : le parcours manuel reste le cœur du produit.** Sidian fonctionne entièrement sans Pennylane ni autre intégration externe, et aucun utilisateur n'est obligé d'en connecter une. Le contrat manuel couvre 100% des cas dès le day one. Les intégrations de facturation restent des compléments optionnels : Pennylane apporte d'abord un accès read-only sans remplacer le contrat Sidian comme source de vérité métier.

Le freelance crée un "contrat" dans Sidian au début de chaque collaboration. C'est la source de vérité pour toutes les échéances.

### Création d'un contrat

Le freelance saisit une seule fois :
- Nom et email du client
- Montant de la facture (ou montant mensuel si récurrent)
- Fréquence : ponctuelle / mensuelle / trimestrielle
- Date de première échéance

Sidian génère automatiquement toutes les échéances à venir.

### Types de contrats

| Type | Mécanisme |
|---|---|
| **Ponctuel** | Une facture, une échéance, une séquence de relance si impayée |
| **Récurrent** | Sidian génère les échéances automatiquement chaque mois/trimestre |

### Positionnement produit

Le contrat Sidian devient un réflexe en début de collaboration, au même titre que le devis ou le bon de commande. Ce n'est pas "un outil anti-impayés" mais "tu sécurises la collaboration dès le départ". Le client signe une fois pour toute la durée.

### Flow d'enrollment client officiel (MVP)

```
Mission validée (freelance a créé le contrat)
          ↓
  Étape 1 — Activer la collaboration
          ↓
  Étape 2 — Validation des informations
          ↓
  Étape 3 — Préférences de paiement
          ↓
  Étape 4 — Collaboration activée
```

#### Étape 1 — Activer la collaboration

**Titre visible :** "Activer la collaboration"

**Description :**
> [Nom du freelance] utilise Sidian pour gérer cette collaboration et simplifier le suivi des paiements.
> Quelques informations sont nécessaires avant le démarrage de la mission.

**Objectif UX :** Le client comprend qu'il active une collaboration, pas qu'il signe un accord anti-impayé. Le nom du freelance est visible et rassurant dès la première seconde.

#### Étape 2 — Validation des informations

**Titre visible :** "Validation des informations"

**Contenu affiché :**
- Identité client (nom, société, email)
- Montant de l'échéance ou montant récurrent
- Fréquence : ponctuelle / mensuelle / trimestrielle
- Date de première échéance
- Récapitulatif de mission

**Objectif UX :** Ressemble à une validation de bon de commande ou de projet. Pas de mention de paiement à ce stade.

#### Étape 3 — Préférences de paiement

**Titre visible :** "Préférences de paiement"

**Texte recommandé :**
> Vous enregistrez votre moyen de paiement une seule fois.
> Si les échéances sont réglées normalement, aucune action n'est nécessaire.
> En cas d'oubli ou de retard, des rappels automatiques sont envoyés avant toute tentative de paiement.

**Contenu :**
- Texte d'autorisation universel affiché
- Checkbox obligatoire d'acceptation
- Interface Stripe Setup Intent (3DS2)

**Bouton principal :** **"Enregistrer mon moyen de paiement"**

**Objectif UX :** L'enregistrement du moyen de paiement intervient uniquement à cette étape. Le moyen de paiement ne doit jamais être la première chose visible.

#### Étape 4 — Collaboration activée

**Titre visible :** "Collaboration activée"

**Texte affiché :**
> Votre collaboration avec [Nom du freelance] est maintenant active.
> Sidian vous aidera à suivre les échéances et à éviter les oublis administratifs.

---

### Accord client + autorisation de paiement (MVP)

Le principe de consentement est inchangé. L'étape 3 ("Préférences de paiement") sert de mini-accord Sidian : elle présente le texte d'autorisation, recueille la checkbox obligatoire et conserve une preuve horodatée du consentement avant tout Setup Intent.

Le contrat ne devient actif que lorsque deux conditions sont remplies :
1. le client a accepté l'autorisation Sidian (étape 3) ;
2. le moyen de paiement a été enregistré avec succès via Stripe Setup Intent.

Sidian stocke obligatoirement :
- Le texte d'autorisation accepté
- L'horodatage d'acceptation
- L'adresse IP du client
- Le user agent du client
- Un snapshot JSON du contrat accepté au moment T

Pas de signature électronique certifiée au MVP. La signature avancée ou certifiée, ainsi que le PDF récapitulatif signé, sont des évolutions V2/V3 éventuelles.

---

### Vocabulaire client — règles obligatoires

**Mots interdits dans tous les écrans, emails et textes visibles par le client :**

| Interdit | Utiliser à la place |
|---|---|
| anti-impayé | collaboration simplifiée / paiement simplifié |
| mauvais payeur | — (ne jamais catégoriser le client) |
| recouvrement | suivi automatique |
| sanction | — (ne jamais menacer) |
| dette | échéance |
| prélèvement forcé | paiement automatique autorisé |
| débit forcé | paiement automatique autorisé |
| paiement garanti | carte enregistrée comme garantie |
| Sidian garantit l'encaissement | — (ne jamais promettre) |
| Sidian détient l'argent | l'argent va directement au freelance |
| le paiement réussira forcément | — (ne jamais promettre) |
| menace | — |
| protection contre les impayés | activation de la collaboration |

**Vocabulaire recommandé (client-facing) :**
collaboration · paiement simplifié · échéance · suivi · rappel · automatisation · activation · préférences de paiement · collaboration active · **payer en un clic** · **paiement automatique autorisé** · **carte enregistrée comme garantie** · **l'argent va directement au freelance** · **Sidian ne conserve jamais les fonds**

> **Note d'exécution — Juin 2026, mise en cohérence 6 juillet 2026 :**
> Les blocs B1/B2/B3 initiaux sont terminés. L'ancien jalon "B4 Enrollment réel"
> correspond désormais au **Lot 4 — Enrollment client dans le contexte du compte
> Stripe connecté** défini au §10.
> Le flow est refondu en 4 étapes conformément au flow officiel ci-dessus :
> - Étape 1 "Activer la collaboration" (nouvelle landing)
> - Étape 2 "Validation des informations" (refonte de l'AccordStep sans checkbox ni paiement)
> - Étape 3 "Préférences de paiement" (consent checkbox + Stripe Elements réel)
> - Étape 4 "Collaboration activée" (confirmation)
>
> Les exigences suivantes restent obligatoires (§11, §16) et relèvent du Lot 4 :
> - Stockage du consentement avant tout Setup Intent (`authorization_text`, `authorization_accepted_at`, `authorization_ip`, `authorization_user_agent`, `contract_snapshot`)
> - Setup Intent Stripe réel (Stripe Elements — remplace le mockup `setTimeout`)
> - Résolution du token depuis Supabase (remplace `ENROLLMENT_MOCK_BY_TOKEN`)
> - Passage de statut `authorization_pending` → `payment_method_pending` → `active`
>
> **Ordre de priorité historique clôturé :** B1 Supabase Foundation → B2 Auth → B3 Clients/Contrats → Lot 4 Enrollment réel.

### Règle critique

L'enrollment couvre les contrats créés avant ou au moment de sa finalisation :
`contract.created_at <= enrollment.enrolled_at`. Un contrat créé strictement
après `enrolled_at` n'est pas couvert et exige un nouvel enrollment ou un
nouveau consentement. La borne d'égalité est autorisée.

### Roadmap intégrations

| Phase | Approche |
|---|---|
| **MVP — parcours principal** | Saisie manuelle via contrat Sidian, pleinement fonctionnelle sans intégration externe |
| **Lot B1.1 — livré** | OAuth 2.0 Pennylane read-only, refresh, révocation, chiffrement et isolation tenant |
| **Lot B2a — livré** | Catalogue Pennylane optionnel read-only : clients et factures |
| **Lot B2b — livré** | Import contrôlé clients et factures Pennylane vers copie Sidian autonome |
| **Lot B2c — livré** | Action « Sécuriser avec Sidian » sur facture importée |
| **Versions ultérieures** | Import PDF, webhooks, synchronisations et autres intégrations selon demande |

---

## 5. Intégration optionnelle Pennylane API v2 (B1.1 + B2a + B2b)

> Pennylane est une intégration optionnelle. B1.1 et B2a sont read-only côté provider.
> B2b importe vers Sidian sans écrire vers Pennylane. Le parcours manuel reste le cœur du MVP.

### Lot B1.1 — socle OAuth livré

Le Lot B1.1 couvre :

- OAuth 2.0 avec scopes read-only ;
- callback et gestion sûre des erreurs OAuth ;
- refresh automatique du token côté serveur ;
- révocation provider-side ;
- chiffrement des credentials ;
- stockage exclusif dans `external_integrations` ;
- statut de connexion visible dans `/parametres` ;
- isolation tenant.

Les credentials Pennylane ne sont jamais stockés dans `profiles.pennylane_token`. Le code serveur réutilise exclusivement `ensurePennylaneAccessTokenForServer()` pour vérifier l'intégration, rafraîchir le token si nécessaire et obtenir un access token déchiffré sans l'exposer au navigateur.

### Lot B2a — catalogue read-only

Endpoints de collection utilisés :

```text
GET /api/external/v2/customers           → consulter les clients
GET /api/external/v2/customer_invoices   → consulter les factures clients
```

Scopes requis :

- `customers:readonly` ;
- `customer_invoices:readonly`.

Le catalogue B2a permet uniquement :

- la consultation des clients et des factures clients Pennylane ;
- la pagination par curseur opaque et le chargement incrémental ;
- la recherche et les filtres locaux sur les éléments déjà chargés ;
- l'affichage de l'état de liaison à Sidian, calculé en lecture seule depuis `external_customer_links` et `external_invoice_links` ;
- des réponses normalisées et défensives qui n'exposent jamais le payload brut du provider.

Le tenant provient toujours de la session serveur. Le lot réutilise `external_integrations`, le chiffrement et le refresh B1.1, ainsi que les tables de liens existantes. Aucun identifiant tenant, token ou URL provider ne vient du navigateur.

### Hors périmètre B2a

Sont explicitement interdits dans B2a :

- import ou création d'un client Sidian depuis Pennylane ;
- import ou création d'une facture Sidian depuis Pennylane ;
- création d'un contrat ou d'un enrollment ;
- action « Sécuriser avec Sidian » ou automatisation équivalente ;
- écriture Sidian vers Pennylane ;
- webhook Pennylane ;
- synchronisation automatique ou bidirectionnelle ;
- création, modification ou suppression d'un lien externe ;
- modification du moteur paiement.

### Lot B2c — sécurisation facture importée (livré)

B2c permet :

- l'action « Sécuriser avec Sidian » sur une facture Sidian déjà importée depuis Pennylane ;
- la réutilisation du contrat `one_time` et de la facture créés par B2b (aucune duplication) ;
- un moteur serveur unique partagé avec le parcours manuel et le reenrollment pour créer, réutiliser ou renouveler atomiquement l'enrollment ;
- un cycle d'invitation stable par token, un claim DB lié au cycle et une clé d'idempotence provider stable ;
- la réutilisation exacte d'un pending non expiré et le renouvellement unique d'un expired/cancelled sous verrou PostgreSQL ;
- aucun nouvel email pour un cycle encore valide déjà marqué envoyé ; un cycle expiré est renouvelé atomiquement et un enrollment actif sécurise immédiatement la nouvelle facture ;
- la transition `external_invoice_links.sync_status` de `imported` à `secured` ;
- aucun appel Pennylane à la sécurisation, aucun PaymentIntent, aucun débit à l'enrollment ;
- claim atomique d'invitation email, idempotence Resend dans sa fenêtre provider et saga de reprise documentée, sans promesse d'exactly-once distribué absolu.

Voir `docs/implementation/SIDIAN_LOT_B2C_SECURE_IMPORTED_INVOICE.md`.

### Lot B2b — import contrôlé (livré)

B2b permet :

- l'import explicite d'un client Pennylane vers un client Sidian (création ou association manuelle) ;
- l'import explicite d'une facture Pennylane vers une facture Sidian autonome (contrat `one_time` + lien externe) via RPC transactionnelle `import_pennylane_invoice_atomic`, exécutable uniquement côté serveur (`service_role`) ;
- la relecture serveur des objets Pennylane par ID externe avant validation ;
- l'idempotence via `external_customer_links` et `external_invoice_links` ;
- aucune écriture Sidian → Pennylane, aucun webhook, aucune synchronisation automatique.

Hors périmètre B2b : « Sécuriser avec Sidian », enrollment, paiement, écriture Pennylane.

Voir `docs/implementation/SIDIAN_LOT_B2B_PENNYLANE_IMPORT.md`.

### Historique — périmètre B2a (catalogue read-only)

---

## 6. Schéma Supabase (MVP)

```sql
-- ─── profiles (état actuel en base) ──────────────────────────────────────────
profiles
  id, email,
  -- Les credentials d'intégration ne sont pas stockés sur profiles.
  stripe_account_id TEXT NULL,    -- EXISTS — présent en base, null pour tous les freelancers MVP actuels
  created_at

external_integrations
  -- Connexions provider tenant-scoped ; credentials chiffrés B1.1.
  -- Source exclusive des tokens Pennylane côté serveur.

external_customer_links
  -- Liens tenant-scoped entre clients externes et clients Sidian.
  -- B2a les consulte uniquement pour exposer linked: boolean.

external_invoice_links
  -- Liens tenant-scoped entre factures externes et factures Sidian.
  -- B2a les consulte uniquement pour exposer linked: boolean.

-- ─── profiles — état cible Lot 1 ─────────────────────────────────────────────
-- Schéma cible du Lot 1 — champs NON ENCORE PRÉSENTS en base tant que la migration
-- correspondante n'est pas créée et appliquée.
-- stripe_account_id est déjà présent ; tous les autres champs ci-dessous sont à ajouter.
--
--   stripe_charges_enabled    BOOLEAN DEFAULT false
--   stripe_payouts_enabled    BOOLEAN DEFAULT false
--   stripe_details_submitted  BOOLEAN DEFAULT false
--   stripe_currently_due      TEXT[]  DEFAULT '{}'
--   stripe_past_due           TEXT[]  DEFAULT '{}'
--   stripe_disabled_reason    TEXT    NULL
--   stripe_connect_updated_at TIMESTAMPTZ NULL

clients
  id, email, freelancer_id, enrolled,
  stripe_customer_id,  -- legacy / déprécié si doublon enrollment ; voir §8.5
  fintecture_customer_id,
  enrolled_at,  -- couvre les contrats créés avant ou exactement à cette date
  created_at

contracts
  id, freelancer_id, client_id,
  amount,  -- montant de la facture ou montant mensuel
  frequency (one_time/monthly/quarterly),
  first_due_date,
  status (active/paused/cancelled),
  created_at

invoices
  id, contract_id, freelancer_id, client_id,
  amount_cents, balance_cents,
  due_date,
  -- Statuts métier séparés (ne pas mélanger paiement et litige)
  mission_status (
    enrolled | overdue | debit_processing | paid |
    failed_retryable | awaiting_client_action | failed_final | suspended
  ),
  dispute_status (none | open | won | lost),
  -- Double validation virement (anti-double-débit)
  anomaly_status (none/pending/client_claimed_paid/freelancer_confirmed_paid/resolved/payment_allowed),
  client_payment_claimed_at,
  freelancer_payment_confirmed_at,
  freelancer_payment_disputed_at,
  payment_review_deadline_at,
  -- Confirmation freelance J+9
  confirmed_unpaid_at,           -- timestamp de la dernière confirmation "Toujours impayé"
  confirmation_required_at,    -- timestamp à partir duquel J+9 demande une confirmation
  external_payment_reported_at, -- freelance ou client a signalé un paiement externe
  -- Séquence (horodatages opérationnels)
  sequence_step, sequence_started_at,
  j0_sent_at, j5_sent_at, j9_confirmation_sent_at, j10_triggered_at,
  paid_at, cancelled_at,
  created_at, updated_at

payment_attempts
  id, mission_id,               -- FK vers invoices.id
  stripe_payment_intent_id,
  enrollment_payment_method_id, -- moyen figé utilisé par la tentative
  payment_provider,             -- stripe
  payment_method_type,          -- card | sepa_debit
  payment_source (
    reminder_j0 | reminder_j5 | automatic_j10 | automatic_retry
  ),
  status,                       -- pending | processing | requires_action | succeeded | failed | cancelled
  decline_code,
  retry_number,                 -- 0 = tentative initiale, 1 = unique retry J+17
  idempotency_key,              -- UNIQUE — une clé par tentative
  amount, application_fee_amount,
  created_at, updated_at
  -- Contrainte : une seule tentative active (processing/requires_action/pending) par mission

webhook_events
  stripe_event_id,              -- UNIQUE — déduplication obligatoire
  stripe_connected_account_id,  -- event.account pour webhooks Connect ; NULL si événement plateforme
  event_type,
  stripe_object_id,             -- id de l'objet Stripe concerné (pi_..., ch_..., re_..., etc.)
  payload,
  processed_at,                 -- NULL tant que l'événement est seulement reçu
  processing_claimed_at,        -- horodatage interne de claim concurrent Lot 3 ; NULL hors traitement actif
  processing_result,            -- received | processing | processed | duplicate | orphan_connected_account | deferred_to_future_lot | ignored_event_type | retryable_error | permanent_error (+ success/skipped/error legacy temporaires)
  created_at

enrollments
  id, client_id, contract_id, freelancer_id,
  payment_method (stripe/fintecture),
  -- Contexte Stripe Connect (V1) — tous valides UNIQUEMENT sur stripe_connected_account_id
  stripe_connected_account_id,  -- acct_... du freelance rattaché à la mission
  stripe_customer_id,           -- cus_... créé SUR ce compte connecté
  stripe_setup_intent_id,       -- seti_... sur ce compte connecté (usage: off_session)
  stripe_payment_method_id,     -- pm_... attaché au Customer sur ce compte connecté
  fintecture_mandate_id,
  status (authorization_pending/payment_method_pending/active/cancelled/suspended),
  authorization_text, authorization_accepted_at,
  authorization_ip, authorization_user_agent,
  contract_snapshot,  -- jsonb : preuve du contrat accepté au moment T
  cancelled_at, cancelled_by (freelancer/client),
  enrolled_at

enrollment_payment_methods
  id, enrollment_id,
  stripe_connected_account_id,
  provider,                     -- stripe (PSP)
  type,                         -- card | sepa_debit (instrument)
  provider_customer_id,
  provider_payment_method_id,
  provider_mandate_id,
  provider_setup_intent_id,
  status (pending/processing/active/requires_action/failed/revoked),
  is_default,
  activated_at, failed_at, revoked_at,
  created_at, updated_at
  -- Un seul moyen par défaut non révoqué par enrollment ; historique conservé.
  -- Ne jamais ajouter card/sepa_debit à l'enum legacy provider payment_method_type.

sepa_prenotifications
  id, invoice_id, enrollment_id, enrollment_payment_method_id, freelancer_id,
  amount_cents, currency, scheduled_debit_at, notify_at,
  mandate_reference, content_version, idempotency_key,
  status (pending/claimed/sent/failed/superseded/cancelled),
  sent_at, provider_message_id,
  created_at, updated_at
  -- Aucune donnée bancaire sensible ; seule une notification exacte sent autorise le débit.

payment_intents                 -- table legacy / compat — migrer progressivement vers payment_attempts
  id, invoice_id, external_payment_id,
  amount, status, attempt_count, triggered_at
```

**RLS obligatoire sur toutes les tables** — un freelance ne voit jamais les données d'un autre.

### Suppression / archivage client sécurisé

La suppression d'une fiche client est une opération sensible. Le comportement
standard recommandé est **l'archivage**, pas la suppression physique.

**Règle métier :**

- Un client avec historique financier, Stripe, remboursement, litige, tentative
  de paiement, facture payée, événement webhook ou événement d'audit ne doit
  jamais être supprimé physiquement.
- Dans ce cas, Sidian archive le client, neutralise les éléments futurs et
  conserve l'historique financier et l'audit.
- La suppression définitive n'est autorisée que si le client ne possède aucun
  historique financier ou légal lié.

**Archivage client :**

- `clients.status` passe hors des listes actives.
- Les contrats actifs du client sont annulés ou neutralisés selon leur état.
- Les échéances futures non payées sont annulées/suspendues afin qu'aucune
  séquence J+0/J+5/J+9/J+10, retry ou lien de paiement ne reste actif.
- Les enrollments actifs ou pending sont suspendus/cancelled afin que le moyen
  de paiement ne soit plus utilisé.
- Les liens `payment_action_links` non consommés sont révoqués.
- Les alertes futures liées au client peuvent être archivées.
- Un `activity_event` explicite est créé.

**Conservation obligatoire :**

- factures avec historique financier ;
- `payment_attempts` ;
- `payment_intents` legacy ;
- remboursements ;
- litiges ;
- commissions ;
- `webhook_events` ;
- `activity_events` ;
- montants, dates et identifiants Stripe nécessaires à l'audit.

**Anonymisation :**

Si un client archivé possède un historique financier, les données personnelles
non nécessaires peuvent être anonymisées côté Sidian, mais les montants, dates,
identifiants Stripe et preuves d'audit doivent rester cohérents.

**Stripe :**

- Ne jamais supprimer, fermer ou rejeter le compte Stripe Connect du freelance.
- Ne jamais appeler `accounts.delete` ou `accounts.reject` dans ce flux.
- Détacher un PaymentMethod client uniquement si c'est sûr, explicite, côté
  serveur, dans le contexte `stripe_connected_account_id`, et sans casser
  l'historique.
- Supprimer un Customer Stripe uniquement s'il n'est plus référencé par aucun
  historique et si cela n'altère pas l'audit.

**Sécurité :**

- Toute action passe par une Server Action ou route serveur authentifiée.
- L'utilisateur est toujours dérivé de la session serveur (`auth.getUser()`).
- Le navigateur ne fournit jamais `freelancer_id`, `stripe_account_id` ou
  d'autorisation de suppression de données financières.
- L'opération doit être idempotente et protégée contre les doubles clics.
- Aucun `DELETE` direct depuis le client n'est autorisé.

### Migrations SQL requises (architecture paiement MVP finale)

> Fichiers à créer et appliquer avant implémentation code. Ne pas modifier le code applicatif tant que ce document n'est pas validé.

```sql
-- 1. Nouveaux statuts mission (remplace progressivement invoices.status pour la logique métier)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS mission_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispute_status TEXT DEFAULT 'none';

-- 2. Confirmation freelance J+9
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS confirmed_unpaid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS confirmation_required_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_payment_reported_at TIMESTAMPTZ;

-- 3. Horodatages séquence J+0/J+5 (remplace j2_sent_at)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS j0_sent_at TIMESTAMPTZ;
-- j5_sent_at existe déjà ; ajouter j9_confirmation_sent_at
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS j9_confirmation_sent_at TIMESTAMPTZ;

-- 4. Table payment_attempts (remplace / complète payment_intents)
CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES invoices(id),
  stripe_payment_intent_id TEXT,
  payment_source TEXT NOT NULL,  -- reminder_j0 | reminder_j5 | automatic_j10 | automatic_retry
  status TEXT NOT NULL,
  decline_code TEXT,
  retry_number INT NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount INT NOT NULL,
  application_fee_amount INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index : une seule tentative active par mission (à implémenter via contrainte partielle ou trigger)

-- 5. Table webhook_events (déduplication — inclut webhooks Connect)
CREATE TABLE IF NOT EXISTS webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  stripe_connected_account_id TEXT,  -- event.account ; NULL si événement compte plateforme
  event_type TEXT NOT NULL,
  stripe_object_id TEXT,             -- pi_..., ch_..., re_..., dp_..., etc.
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NULL,
  processing_claimed_at TIMESTAMPTZ NULL,
  processing_result TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5b. Identifiants Stripe Connect sur enrollment (contexte connecté obligatoire — §8.5)
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;
-- stripe_setup_intent_id existe déjà

-- 6. Double validation virement (déjà spécifiée — migration 20260705000000)
-- client_payment_claimed_at, freelancer_payment_confirmed_at,
-- freelancer_payment_disputed_at, payment_review_deadline_at
```

**Migration de données :** mapper `invoices.status` existant vers `mission_status` ; conserver `payment_intents` en lecture seule le temps de la migration vers `payment_attempts`.

---

## 7. Flow produit complet

### Étape 1 — Onboarding freelance (une seule fois)

1. Inscription sur Sidian
2. Connexion Stripe Connect (pour recevoir les paiements — voir §8.4)
3. Sidian tourne en arrière-plan — le freelance ne revient que pour créer des contrats et consulter son dashboard

### Étape 2 — Création du contrat + Enrollment client

Le freelance crée un contrat dans Sidian pour un client.
Sidian envoie automatiquement un lien d'enrollment au client (le freelance peut aussi le partager par email, WhatsApp, contrat, Notion).

Le client suit le flow en 4 étapes (voir §4 pour le détail complet de chaque étape) :

```
Étape 1 — Activer la collaboration   (intro + nom du freelance)
Étape 2 — Validation des informations (récapitulatif mission, montant, fréquence)
Étape 3 — Préférences de paiement    (consent checkbox + Stripe Setup Intent + 3DS2)
Étape 4 — Collaboration activée      (confirmation)
```

**Texte d'autorisation universel (affiché à l'étape 3) :**
> *"J'autorise [Freelance] via Sidian à débiter automatiquement toutes les factures émises à mon nom, ponctuelles ou récurrentes, uniquement si elles ne sont pas réglées à l'échéance. Révocable à tout moment."*

Au clic sur **"Enregistrer mon moyen de paiement"** (étape 3), Sidian enregistre le consentement client (`authorization_text`, `authorization_accepted_at`, `authorization_ip`, `authorization_user_agent`, `contract_snapshot`), puis déclenche seulement ensuite le Stripe Setup Intent.

Enrollment en 30 secondes. Valide pour toute la durée de la collaboration sans nouvelle autorisation.

**Framing UX client :** Le moyen de paiement n'est jamais la première chose visible. Le client perçoit une activation de collaboration, pas une mise sous protection anti-impayé. Même mécanique que Netflix ou Amazon, psychologie radicalement différente.

**⚠️ Règle critique :** l'enrollment couvre uniquement les contrats créés avant
ou exactement au moment de sa finalisation (`contract.created_at <=
enrollment.enrolled_at`). Tout contrat créé strictement après exige un nouvel
enrollment ou un nouveau consentement.

**V2 uniquement :** ajout virement automatique Fintecture VRP à l'étape 3 (alternative carte). Hors périmètre MVP/bêta.

### Étape 2b — Virements externes et paiements hors Stripe

Un client ou un freelance peut signaler un règlement externe (virement bancaire direct, hors Stripe) :

| Situation | Action Sidian |
|---|---|
| Client déclare avoir payé | Séquence suspendue 24h + alerte freelance + `client_payment_claimed_at` |
| Freelance confirme réception | Séquence annulée + `external_payment_reported_at` — **0% commission** |
| Freelance conteste ou silence 24h | Séquence reprend (anomaly → `payment_allowed`) |
| Les deux confirment | Séquence annulée + `external_payment_reported_at` |
| Freelance signale réception seul (avant J+0) | Séquence annulée immédiatement — **0% commission** |

**Commission sur virements externes :** Aucune commission. Aucun PaymentIntent Stripe créé. `external_payment_reported_at` bloque tout débit J+10.

### Étape 3 — Séquence de relance et paiement (J+0 → J+10)

> **Référence complète :** voir §7.1 *Architecture de paiement Sidian — Version finale MVP*.

**Résumé opérationnel :**

| Jour | Action | Destinataire |
|---|---|---|
| **J0 (enrollment)** | SetupIntent `usage: off_session`, consentement, mission → `enrolled` | Client |
| **Paiement à temps** | Freelance signale réception externe → séquence annulée, 0% commission | — |
| **J+0** | Échéance impayée → `overdue` + rappel avec **lien Stripe payer en un clic** (direct charge + `application_fee_amount`) | Client |
| **J+5** | Deuxième relance + même lien Stripe, ton plus ferme, mention du débit J+10 | Client |
| **J+9** | **Aucune relance client** — Sidian demande au freelance : `Toujours impayé` ou `Paiement reçu` | Freelance |
| **J+10** | PaymentIntent off-session si confirmation freelance récente (< 24h) — direct charge, montant total, une seule tentative active | Stripe |

**Montant tenté : toujours le solde restant (`balance_cents`), jamais un débit partiel.**

Si le client paie via un lien Stripe (J+0 ou J+5) → commission Sidian enregistrée après `payment_intent.succeeded` → toutes relances et retries annulés.

Si le freelance signale un paiement externe reçu → séquence arrêtée immédiatement → 0% commission → aucun PaymentIntent créé.

### Étape 4 — Flow anti-double-débit (anomalies strictes)

| Signal reçu | Action Sidian |
|---|---|
| Freelance confirme "déjà réglée" | Séquence annulée |
| Client confirme "déjà réglée" | Séquence suspendue + alerte freelance sous 24h |
| Client + freelance confirment | Séquence annulée |
| Client confirme + freelance conteste | Séquence procède |
| Client confirme + freelance silencieux 24h | Séquence procède — trace d'audit conservée |
| Aucun ne confirme | Séquence procède automatiquement |

**Principe produit : le freelance peut annuler seul. Le client peut suspendre, mais pas bloquer seul.**

### Étape 5 — Couches de fiabilité

1. SetupIntent `usage: off_session` à l'enrollment — carte ou SEPA enregistré, consentement explicite, aucun débit
2. Rappel J+0 avec lien Stripe payer en un clic — le client peut régler avant toute escalade
3. Relance J+5 — second filet avec le même parcours Stripe
4. Confirmation freelance obligatoire à J+9 — aucun débit J+10 sans `confirmed_unpaid_at` récent (< 24h)
5. Paiement automatique autorisé à J+10 — une seule tentative active, idempotence stricte
6. Politique d'échec — un seul retry automatique à J+17 après un échec J+10 `failed_retryable`, jamais pendant `processing`
7. Webhooks Stripe = seule source de vérité du résultat final — `mission_status = paid` uniquement après `payment_intent.succeeded`
8. Aucun fallback automatique entre moyens : le retry reprend exclusivement le moyen figé sur la tentative J+10

**Moyens MVP :** carte recommandée par défaut et SEPA Direct Debit disponible comme alternative active. Aucun seuil automatique par montant.

> **Risque connu et accepté (bêta) :** La carte enregistrée ne garantit pas qu'un futur débit off-session réussira sans authentification supplémentaire (`authentication_required`). Les plafonds bancaires peuvent bloquer les montants élevés. Ne pas présenter la carte comme garantie de réussite sur tous les montants.

---

## 7.1 Architecture de paiement Sidian — Version finale MVP

> Section normative. Toute implémentation de paiement, cron, webhook ou UI doit s'y conformer.

### J0 — Enrôlement du client

Au démarrage de la mission :

- le client accepte explicitement les conditions de paiement futur ;
- il enregistre sa carte avec un Stripe SetupIntent configuré avec `usage: "off_session"` **sur le compte Stripe Connecté du freelance** (voir §8.5) ;
- une authentification 3DS peut être demandée par l'émetteur ;
- **aucun montant n'est débité** à ce moment-là ;
- la mission passe au statut `mission_status = enrolled`.

La carte enregistrée constitue une **garantie de paiement**, mais ne garantit pas qu'un futur débit réussira sans authentification supplémentaire.

```typescript
// SetupIntent — enrollment client (contexte compte connecté du freelance)
const connectedAccountId = profile.stripe_account_id;

// Customer créé SUR le compte connecté — jamais uniquement sur le compte plateforme
const customer = await stripe.customers.create(
  { email: client.email, metadata: { sidian_client_id: client.id } },
  { stripeAccount: connectedAccountId }
);

const setupIntent = await stripe.setupIntents.create(
  {
    customer: customer.id,
    usage: "off_session",
    payment_method_types: ["card"],
  },
  { stripeAccount: connectedAccountId }
);

// Persister sur enrollment : stripe_connected_account_id, stripe_customer_id,
// stripe_setup_intent_id, stripe_payment_method_id (après confirmation)
```

### Paiement à temps (externe)

Si le client paie à temps et que le freelance signale le règlement comme reçu :

- Sidian ne déclenche **aucune relance** ;
- **aucun PaymentIntent Stripe** n'est créé ;
- **aucune commission Sidian** n'est facturée ;
- toute tâche de relance ou de débit liée à cette mission est **annulée** ;
- `external_payment_reported_at` est renseigné.

### J+0 — Premier rappel (jour de l'échéance)

Si le paiement n'a pas été signalé comme reçu le jour de l'échéance :

- `mission_status` passe à `overdue` ;
- Sidian envoie un premier rappel au client ;
- le rappel contient un **lien de paiement Stripe** permettant de régler en un clic ;
- le paiement est une **direct charge** sur le compte Stripe Connecté du freelance ;
- le paiement inclut `application_fee_amount` pour la commission Sidian ;
- l'argent principal va **directement au freelance** ;
- Sidian **ne conserve jamais** le montant principal.

```typescript
// Direct charge sur le compte connecté du freelance
const paymentIntent = await stripe.paymentIntents.create(
  {
    amount: invoice.balance_cents,
    currency: "eur",
    customer: enrollment.stripe_customer_id,
    payment_method: enrollment.stripe_payment_method_id,
    application_fee_amount: fee_cents,
    metadata: {
      sidian_invoice_id: invoice.id,
      payment_source: "reminder_j0",
    },
  },
  {
    stripeAccount: profile.stripe_account_id, // direct charge
    idempotencyKey: `sidian-j0-${invoice.id}-${attemptId}`,
  }
);
```

### J+5 — Deuxième relance

Si aucun paiement Stripe réussi n'a été reçu et que le freelance n'a pas signalé de paiement externe :

- Sidian envoie une deuxième relance ;
- le **même parcours Stripe** (direct charge + `application_fee_amount`) est utilisé ;
- le ton est légèrement plus ferme ;
- le message précise qu'un **paiement automatique autorisé** pourra être tenté à J+10 si la somme reste due.

### J+9 — Confirmation obligatoire du freelance

À J+9 :

- Sidian **ne relance plus le client** ;
- Sidian demande au freelance de confirmer que le paiement est toujours impayé ;
- le freelance choisit :
  - **`Toujours impayé`** → enregistre `confirmed_unpaid_at = now()`
  - **`Paiement reçu`** → séquence immédiatement arrêtée, `external_payment_reported_at` renseigné

**Règle bloquante :** sans confirmation récente `Toujours impayé` (`confirmed_unpaid_at` datant de **moins de 24 heures** au moment de la création du PaymentIntent J+10), **aucun débit automatique** ne doit être créé.

Champs requis :

```typescript
confirmed_unpaid_at: string | null;        // dernière confirmation "Toujours impayé"
confirmation_required_at: string | null;   // horodatage de la demande J+9
external_payment_reported_at: string | null;
```

### J+10 — Paiement automatique autorisé

Si le freelance a confirmé que le paiement reste dû (`confirmed_unpaid_at` < 24h) :

- Sidian crée un PaymentIntent **off-session** avec le moyen de paiement figé pour la tentative (`card` ou `sepa_debit`) ;
- **direct charge** sur le compte connecté du freelance ;
- `application_fee_amount` intégré ;
- le **montant total** (`balance_cents`) est tenté — **aucun débit partiel** ;
- **une seule tentative active** à la fois ;
- clé d'idempotence **unique** par tentative ;
- `mission_status = debit_processing` lors de la création du PaymentIntent ;
- `mission_status = paid` **uniquement** après webhook `payment_intent.succeeded`.

**Conditions obligatoires avant création du débit J+10 :**

```text
date J+10 atteinte
AND confirmed_unpaid_at récent (< 24h)
AND mission_status NOT IN (paid, suspended)
AND aucun payment_intent.succeeded existant
AND external_payment_reported_at IS NULL
AND aucune tentative active (processing | requires_action | pending)
AND mission non suspendue (dispute_status n'empêche pas le débit si impayée — voir litiges)
AND compte Connect prêt (charges_enabled = true)
```

### J+17 — Retry automatique unique

Le MVP autorise au maximum une tentative automatique initiale à J+10 et un seul
retry automatique à J+17. J+17 correspond à sept jours calendaires après la
date de débit initiale J+10. Les deux dates dérivent de la même échéance métier
de facture, actuellement `invoice.due_date`.

Les dates métier sont interprétées dans la timezone `Europe/Paris`, puis
normalisées par l'application pour leur persistance et leur comparaison. Le
calcul ne part jamais de l'heure locale du serveur, de la réception d'un webhook
ou du timestamp aléatoire d'un worker.

Le retry SEPA J+17 exige cumulativement :

- tentative J+10 `payment_provider = stripe`, `payment_method_type = sepa_debit` et `status = failed_retryable` ;
- échec terminal, jamais un état `processing` prolongé ;
- aucune tentative liée `processing` ou `succeeded` ;
- aucun retry J+17 déjà créé ;
- facture non payée, non annulée, solde strictement positif et aucun règlement externe ;
- enrollment valide ;
- moyen figé sur la tentative J+10 toujours actif, complet et cohérent avec le même compte Connect ;
- date J+17 atteinte ;
- pré-notification exacte du retry au statut `sent`.

La pré-notification J+10 ne couvre pas automatiquement J+17. La notification du
retry doit correspondre exactement à la facture, l'enrollment, le moyen figé,
le montant, la devise, la date J+17 et la version active du contenu. Les états
`pending`, `claimed`, `failed`, `cancelled` et `superseded` n'autorisent aucun débit.

Le contexte du moyen est immuable et comprend au minimum
`enrollment_payment_method_id`, `payment_provider`, `payment_method_type`, le
compte Stripe Connect, le Customer Stripe et le PaymentMethod Stripe. Aucun
fallback automatique vers une carte, un autre compte bancaire, un autre SEPA
ou le moyen par défaut courant n'est autorisé.

Après l'échec du retry J+17, le cycle de débit automatique est terminé, même si
le motif serait théoriquement retryable. Aucun troisième débit automatique ne
peut être créé. Une dispute postérieure à un succès relève du flux dispute et
ne rend jamais le paiement éligible à un retry.

### Origine des paiements (`payment_source`)

```typescript
type PaymentSource =
  | "reminder_j0"      // lien payer en un clic du rappel J+0
  | "reminder_j5"      // lien payer en un clic de la relance J+5
  | "automatic_j10"    // débit off-session J+10
  | "automatic_retry"; // retry automatique unique J+17
```

Tous les paiements Stripe (J+0, J+5, J+10, retries) partagent le même modèle économique : direct charge + `application_fee_amount`, commission enregistrée **uniquement** après `payment_intent.succeeded`.

### États métier — deux champs séparés

```typescript
type MissionStatus =
  | "enrolled"              // mission active, échéance future ou en attente
  | "overdue"               // échéance dépassée, relances en cours
  | "debit_processing"      // PaymentIntent créé, webhook en attente
  | "paid"                  // payment_intent.succeeded reçu
  | "failed_retryable"      // échec retryable (ex. insufficient_funds)
  | "awaiting_client_action" // authentication_required — lien envoyé au client
  | "failed_final"          // échec définitif (carte expirée, do_not_honor, etc.)
  | "suspended";            // code inconnu — intervention manuelle

type DisputeStatus = "none" | "open" | "won" | "lost";
```

**Règle :** un litige ne doit **pas** effacer le fait qu'un paiement a précédemment réussi.

```text
Exemple valide :
  mission_status = paid
  dispute_status = open
```

### Gestion des webhooks Stripe

Les webhooks sont la **seule source de vérité** pour le résultat final d'un paiement.

> **Webhooks Connect :** avec des **direct charges**, les événements de paiement (`payment_intent.*`, `charge.*`, remboursements, litiges) sont émis **sur le compte connecté**, pas sur le compte plateforme. Voir §18.

Événements minimum à gérer :

```text
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.processing
payment_intent.requires_action   (si applicable au flux)
charge.dispute.created
charge.dispute.closed
charge.refunded                  (ou refund.updated selon implémentation)
account.updated                  (sync Connect)
```

**Déduplication obligatoire** — table `webhook_events` :

```typescript
{
  stripe_event_id: string;              // UNIQUE — ne jamais traiter deux fois
  stripe_connected_account_id: string | null;  // event.account (Connect)
  event_type: string;
  stripe_object_id: string | null;      // pi_..., ch_..., etc.
  payload: Json;
  processed_at: string | null;          // NULL tant que reçu mais non terminal
  processing_result:
    | "received"
    | "processing" // état interne de claim concurrent Lot 3
    | "processed"
    | "duplicate"
    | "orphan_connected_account"
    | "deferred_to_future_lot"
    | "ignored_event_type"
    | "retryable_error"
    | "permanent_error"
    | "success"  // legacy temporaire
    | "skipped"  // legacy temporaire
    | "error";   // legacy temporaire
}
```

Ne jamais traiter deux fois le même `stripe_event_id`. Ne jamais marquer `mission_status = paid` à la création du PaymentIntent.

### Politique d'échec (table de décision)

| Code / événement | `mission_status` | Action |
|---|---|---|
| `payment_intent.succeeded` | `paid` | Enregistrer commission, annuler relances/retries |
| échec terminal classé retryable | `failed_retryable` | Un seul retry automatique à J+17 si toutes les préconditions sont satisfaites |
| `authentication_required` | `awaiting_client_action` | Envoyer lien d'authentification au client — **aucun retry auto** |
| `expired_card`, `incorrect_number` | `failed_final` | Demander nouvelle carte |
| `lost_card`, `stolen_card` | `failed_final` | Arrêt immédiat |
| `do_not_honor` | `failed_final` | Aucun retry auto en V1 |
| code inconnu | `suspended` | Intervention manuelle |

**Il ne doit jamais y avoir plus d'un retry automatique après la tentative J+10.**
`processing` n'est pas un échec et bloque tout retry. `failed_final` ne permet
aucun retry. Le moyen utilisé reste celui figé sur la tentative J+10.

### Verrouillage et idempotence — table `payment_attempts`

```typescript
type PaymentAttempt = {
  id: string;
  mission_id: string;
  stripe_payment_intent_id: string | null;
  payment_source: PaymentSource;
  status: string;
  decline_code: string | null;
  retry_number: number;          // 0 = initiale, 1 = unique retry J+17
  idempotency_key: string;       // UNIQUE
  amount: number;
  application_fee_amount: number;
  created_at: string;
  updated_at: string;
};
```

**Garanties obligatoires :**

- une seule tentative active par mission (contrainte unique ou verrou transactionnel `FOR UPDATE`) ;
- clé d'idempotence unique par tentative ;
- aucun nouveau PaymentIntent si une tentative est en `processing`, `requires_action` ou équivalent ;
- aucun retry après un succès ;
- aucun retry après un `external_payment_reported_at` renseigné.
- aucun retry pendant `processing` ni après `failed_final` ;
- aucun troisième débit automatique ;
- aucun changement automatique du moyen figé sur la tentative initiale.

### Commission Sidian — règle finale

**Applicable** (commission après `payment_intent.succeeded` uniquement) :

- paiement via lien J+0 ;
- paiement via lien J+5 ;
- paiement automatique J+10 ;
- retry automatique réussi.

**Exclu** (0% commission) :

- paiement externe / virement bancaire direct signalé ;
- tentative Stripe échouée ;
- paiement en attente d'authentification ;
- paiement remboursé (traitement comptable selon politique §8.7 — non codée sans validation) ;
- litige perdu (reverse commission selon politique §8.7 — non codée sans validation).

La commission **n'est pas acquise** à la création du PaymentIntent. Le remboursement de l'`application_fee` suit la politique explicite §8.7 — **aucune logique comptable définitive ne doit être codée sans validation**.

### Terminologie produit (marketing)

**Utiliser :** payer en un clic · paiement automatique autorisé · carte enregistrée comme garantie · l'argent va directement au freelance · Sidian ne conserve jamais les fonds

**Ne pas utiliser :** débit forcé · paiement garanti · Sidian garantit l'encaissement · Sidian détient l'argent · le paiement réussira forcément

---

## 8. Architecture Stripe Connect

### 8.1 Architecture cible (production) — Direct charge

```
Client Payment Method (carte, enregistrée via SetupIntent off_session)
      ↓
PaymentIntent créé SUR le compte Connecté du freelance (direct charge)
      ├─► Montant principal → compte Connect du freelance (directement)
      └─► application_fee_amount → commission Sidian (prélevée automatiquement)
```

**Type de charge :** **Direct charge** sur le compte Connecté du freelance — **pas** destination charge, **pas** separate charge and transfer, **pas** platform mode.

**Paramètres obligatoires sur chaque PaymentIntent de production :**

```typescript
// Appel API avec stripeAccount = acct_... du freelance
// customer et payment_method DOIVENT exister sur CE compte connecté (§8.5)
await stripe.paymentIntents.create(
  {
    amount: invoice.balance_cents,
    currency: "eur",
    customer: enrollment.stripe_customer_id,       // cus_... sur le compte connecté
    payment_method: enrollment.stripe_payment_method_id,
    off_session: true,           // J+10 et retries uniquement
    confirm: true,               // J+10 et retries uniquement
    application_fee_amount: fee_cents,
    metadata: {
      sidian_invoice_id: invoice.id,
      payment_source: "automatic_j10", // ou reminder_j0 | reminder_j5 | automatic_retry
    },
  },
  {
    stripeAccount: profile.stripe_account_id,  // OBLIGATOIRE — direct charge
    idempotencyKey: `sidian-attempt-${attemptId}`,
  }
);
// Équivalent API REST : en-tête Stripe-Account: acct_...
```

**Interdictions absolues :**

- Ne jamais créer un PaymentIntent sur le compte plateforme Sidian sans `stripeAccount`
- Ne jamais créer le Customer ou le PaymentMethod uniquement sur le compte plateforme puis supposer qu'ils seront utilisables sur le compte connecté (§8.5)
- Ne jamais utiliser `transfer_data.destination` (modèle destination charge — **obsolète** pour Sidian)
- Ne jamais prévoir un reverse manuel comme fonctionnement de production ordinaire
- Ne jamais conserver le montant principal sur le compte Sidian

**`on_behalf_of` :** Ne pas utiliser par défaut. À auditer uniquement si le libellé bancaire client l'exige.

**Commission :** Confirmée uniquement après `payment_intent.succeeded`. Un PI échoué ne génère aucune commission acquise.

### 8.2 Règle non négociable — Platform mode et destination charge interdits en production

> **Toute implémentation où les fonds transitent par le compte plateforme Sidian (platform mode, destination charge avec reverse manuel) est interdite en production.**
>
> **Chaque PaymentIntent réel doit être une direct charge sur le compte Connecté du freelance via `stripeAccount`.**

Interdictions absolues :
- Ne jamais créer un PaymentIntent réel sur le compte plateforme sans `stripeAccount`
- Ne jamais utiliser `transfer_data.destination` comme modèle principal
- Ne jamais utiliser le platform mode comme fallback silencieux
- Ne jamais prévoir un reverse manuel comme fonctionnement de production ordinaire
- Ne jamais traiter l'absence de Connect comme un échec de paiement du client
- Ne jamais laisser des fonds destinés au freelance stationnaires sur le compte Sidian

**Si Connect n'est pas prêt à J+10 :**
- Aucun PaymentIntent créé
- Invoice placée en état "action requise côté freelance"
- Alerte critique générée
- Trace d'audit conservée
- Reprise idempotente après régularisation du compte Connect

### 8.3 Critères d'un compte Connect prêt

Un `stripe_account_id` présent ne suffit pas. Conditions minimales pour déclencher un PI :

| Condition | Champ DB (état cible Lot 1) | Vérification |
|---|---|---|
| `stripe_account_id` présent | `profiles.stripe_account_id` (EXISTS) | `IS NOT NULL` |
| Paiements activés | `profiles.stripe_charges_enabled` (Lot 1) | `= true` |
| Versements activés | `profiles.stripe_payouts_enabled` (Lot 1) | `= true` |
| Aucune exigence bloquante | `profiles.stripe_currently_due` (Lot 1) | tableau vide |
| Aucun blocage passé | `profiles.stripe_past_due` (Lot 1) | tableau vide |
| Compte non restreint | `profiles.stripe_disabled_reason` (Lot 1) | `IS NULL` |

**Statuts Connect internes (à implémenter) :**

| Statut | Condition |
|---|---|
| `not_connected` | `stripe_account_id IS NULL` |
| `onboarding_in_progress` | ID présent, `charges_enabled = false` |
| `awaiting_verification` | `charges_enabled`, `payouts_enabled = false` |
| `requirements_pending` | `currently_due` non vide |
| `ready` | Tous les critères satisfaits |
| `restricted` | Capabilities temporairement désactivées |

### 8.4 Configuration des comptes Connect

> Ne pas présenter Express et Standard comme les seules options modernes à choisir ultérieurement.

**Comptes existants (bêta) :**

- Les comptes Connect déjà créés **ne doivent pas être migrés brutalement** si la migration risque de casser la bêta (onboarding interrompu, IDs invalides, webhooks décalés).
- Un compte Express déjà provisionné peut **rester temporairement supporté** tant que la bêta l'exige.
- Toute migration de type de compte ou de modèle de charge doit être planifiée, testée en mode test Stripe, et réversible.

**Nouveaux comptes (architecture cible) :**

- Pour tout **nouveau** compte Connect, l'architecture cible doit utiliser les **controller properties** modernes de Stripe (`controller.fees.payer`, `controller.losses.payments`, `controller.requirement_collection`, etc.) plutôt qu'un `type: "express"` ou `type: "standard"` codé en dur comme choix d'architecture.
- Express **ne doit pas être imposé** dans la nouvelle architecture : c'est un héritage acceptable pour l'existant, pas la norme cible.
- Le choix des controller properties doit être documenté et validé avant tout déploiement live (impact KYC, responsabilité des litiges, UX onboarding).

**Référence Stripe :** [Connect controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties) — à consulter avant implémentation Lot 2.

### 8.5 Contexte Stripe des objets de paiement — V1

> Section normative. Cohérence obligatoire avec la direct charge (§8.1).

**Règle fondamentale :** en V1, **chaque mission** (invoice) est rattachée à **un seul** compte Stripe Connecté freelance. Tous les objets Stripe du parcours paiement vivent **dans le contexte de ce compte connecté**, jamais isolés sur le compte plateforme Sidian.

| Étape | Objet Stripe | Contexte obligatoire |
|---|---|---|
| Enrollment J0 | Customer (`cus_...`) | Créé **sur** le compte connecté du freelance |
| Enrollment J0 | SetupIntent `usage: "off_session"` | Créé **sur** le même compte connecté |
| Enrollment J0 | PaymentMethod (`pm_...`) | Attaché au Customer **sur** le même compte connecté |
| J+0 / J+5 | PaymentIntent (lien payer en un clic) | Créé **sur** le même compte connecté |
| J+10 / retries | PaymentIntent off-session | Créé **sur** le même compte connecté |

**Appels API :** tous les appels concernés passent `{ stripeAccount: acct_... }` (SDK) ou l'en-tête HTTP `Stripe-Account: acct_...` (API REST).

**Interdiction explicite :** il est **interdit** de créer le Customer ou le PaymentMethod uniquement sur le compte plateforme puis de supposer qu'ils seront utilisables directement sur le compte connecté lors d'une direct charge.

**Identifiants à persister (enrollment / mission) :**

```typescript
stripe_connected_account_id: string;  // acct_... — contexte de validité de tous les IDs ci-dessous
stripe_customer_id: string;           // cus_... — valide UNIQUEMENT sur ce compte connecté
stripe_setup_intent_id: string;       // seti_... — valide UNIQUEMENT sur ce compte connecté
stripe_payment_method_id: string;     // pm_... — valide UNIQUEMENT sur ce compte connecté
```

Ces identifiants ne sont **pas** interchangeables entre comptes connectés. Toute requête Stripe qui les utilise doit inclure le `stripeAccount` / `Stripe-Account` correspondant à `stripe_connected_account_id`.

**Hors périmètre V1 :** partage d'un même PaymentMethod entre plusieurs comptes connectés (multi-freelance, marketplace cross-account). Si un client collabore avec plusieurs freelances, chaque enrollment crée son propre Customer et PaymentMethod sur le compte connecté du freelance concerné.

### 8.6 Onboarding freelance Connect — Phase MVP

Flux Stripe-hosted actuellement en bêta (peut utiliser Express pour les comptes existants — voir §8.4) :
1. Créer compte Connect via `accounts.create()` (controller properties cible pour les nouveaux comptes)
2. Stocker `acct_...` immédiatement dans `profiles.stripe_account_id` (avant la redirection)
3. Créer Account Link (`accountLinks.create()`) avec `return_url` et `refresh_url` — `{ stripeAccount }` si requis
4. Rediriger vers Stripe
5. Sur retour : lire `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements.currently_due`
6. Synchroniser l'état dans Supabase
7. Gérer la reprise si le freelance interrompt l'onboarding

> **Erreur fréquente :** écrire `stripe_account_id` après la redirection ou dépendre du webhook pour le premier stockage. L'ID doit être persisté dès que Stripe retourne `acct_...`, avant d'envoyer le freelance vers Stripe.

**Phase ultérieure (V1.1) :** Stripe Embedded Account Onboarding (composant dans-app via Account Session) pour réduire le départ de l'application.

### 8.7 Remboursements, litiges et commission (P0 avant production live)

Pour une **direct charge** sur compte Connecté :

**Remboursement du paiement et de la commission :**

> Avec une direct charge, le remboursement du paiement **ne rembourse pas nécessairement automatiquement** l'`application_fee` (commission Sidian). La politique V1 doit être explicite avant tout code comptable définitif.

| Cas | Politique V1 (à valider avant implémentation comptable) |
|---|---|
| **Remboursement total** | `application_fee` remboursée **intégralement** (`refund_application_fee: true` ou équivalent API) |
| **Remboursement partiel** | `application_fee` remboursée **au prorata** du montant remboursé, sauf décision contractuelle différente documentée |
| **Litige perdu** | Commission Sidian **reversée** ou enregistrée comme **dette** selon la règle comptable validée — aucune logique définitive codée sans validation finance |
| **Toute autre règle** | Ne pas coder de logique comptable définitive sans validation explicite (finance / juridique) |

**Remboursement — opérations Stripe :**

- Le refund est initié **sur le compte Connect** du freelance (`stripeAccount`)
- Ne jamais supposer que le Charge ou le PaymentIntent est accessible sur le compte plateforme
- **À gérer en DB :** `mission_status`, commission, `dispute_status`, activité, alerte freelance
- Ne pas remettre `dispute_status = none` si un litige était ouvert

**Litige (chargeback) :**

- Dispute ouverte **sur le compte Connect** du freelance (événement webhook Connect — §18)
- **`dispute_status = open`** — **`mission_status` reste `paid`** (le paiement a bien eu lieu)
- Si perdu (`dispute_status = lost`) : traitement comptable commission selon politique validée (§ ci-dessus) + alerte critique
- Si gagné (`dispute_status = won`) : clôture du litige, mission reste `paid`

**Webhooks obligatoires avant tout paiement live :** voir §18.

---

## 9. Méthode de paiement MVP

### MVP / bêta privée — carte et SEPA Direct Debit

Le paiement automatique Sidian utilise :
- Stripe comme unique provider actif
- Carte bancaire (`card`), présélectionnée et recommandée par défaut
- SEPA Direct Debit (`sepa_debit`, SEPA Core), alternative active choisissable par le client
- Stripe SetupIntent `usage: "off_session"` pour l'enregistrement du moyen de paiement
- Liens Stripe payer en un clic (J+0, J+5) — direct charge + `application_fee_amount`
- Stripe PaymentIntent off-session déclenché à J+10, puis au maximum un retry automatique à J+17 après un échec terminal retryable

**Hors périmètre MVP — ne pas intégrer :**
- Fintecture / Open Banking
- SEPA B2B
- second provider de paiement
- sélection automatique du moyen selon un seuil de montant

**Recommandation MVP :** `recommendedType = card`,
`availableTypes = ["card", "sepa_debit"]`,
`ruleVersion = mvp_card_default_with_sepa`. Aucun seuil automatique par montant
n'est codé. `provider = stripe` reste distinct de
`type = card | sepa_debit`.

### 9.1 Verrou d'activation paiements — `PAYMENTS_DIRECT_CHARGE` + `PAYMENTS_PRODUCTION_ENABLED`

Point de contrôle unique : `lib/payments/migration-lock.ts` (`resolvePaymentsGate`). **Deny par défaut, fail-closed.** `NODE_ENV` seul n'est **jamais** une autorisation de paiement.

Deux flags indépendants :

- `PAYMENTS_DIRECT_CHARGE` — verrou maître de la migration direct charge (deny si absent) ;
- `PAYMENTS_PRODUCTION_ENABLED` — **cran d'activation prod dédié**, exigé en plus pour tout prélèvement **live**.

**Comportement (Lots 7/8 livrés — architecture direct charge active) :**

| `PAYMENTS_DIRECT_CHARGE` | Env | `PAYMENTS_PRODUCTION_ENABLED` | Clé Stripe | Résultat |
|---|---|---|---|---|
| absent / `false` | tous | — | — | **bloqué** (`flag_disabled`) |
| `true` | hors prod | — | `sk_test_` | **autorisé** — prélèvements Stripe **test** |
| `true` | production | absent / `false` | — | **bloqué** (`production_not_enabled`) |
| `true` | production | `true` | `sk_test_` | **bloqué** (`stripe_mode_mismatch`) |
| `true` | production | `true` | `sk_live_` | **autorisé** — prélèvements **live** |

> **Activation prod = geste délibéré séparé.** En production, débit live uniquement si `PAYMENTS_PRODUCTION_ENABLED=true` **et** clé `sk_live_`. Toute clé test en prod → `stripe_mode_mismatch` (défense en profondeur ; Stripe rejette aussi nativement un compte connecté cross-mode). Aucun identifiant test n'est accepté en production.

**Chemins soumis au gate :** J+10 automatique (`automatic-j10.ts`), retries automatiques (`automatic-retry.ts`). Mêmes règles.

**Chemins de test — restent interdits en production**, garde séparée `isTestPaymentTriggerEnabled` : route `/api/test/cron/j10` et bouton « Prélever maintenant en test » (`invocationSource:"test"`).

Le fallback platform-mode (fonds captés sur le compte plateforme, reverse manuel) est **supprimé** : `stripe_account_id` absent → `connect_not_configured`, aucun PaymentIntent, action requise côté freelance. Ancien chemin destination charge / platform-mode → **définitivement interdit**.

---

## 10. Ordre de développement officiel (post-audit Stripe Connect)

> Les blocs B1–B9 initiaux sont terminés. Ce plan est l'ordre officiel à suivre.
> Refunds et disputes ne doivent pas être implémentés avant les paiements : ils
> relèvent du Lot 9.

### Synthèse officielle des lots

- Lot 0 — Sécurisation et feature flags
- Lot 1 — Schéma et migrations
- Lot 2 — Onboarding Stripe Connect
- Lot 3 — Socle webhooks Stripe Connect
- Lot 4 — Enrollment client dans le contexte du compte connecté
- Lot 5 — Liens de paiement J+0 et J+5
- Lot 6 — Confirmation freelance J+9
- Lot 7 — Direct charge automatique J+10
- Lot 8 — Retries automatiques
- Lot 9 — Refunds et disputes
- Lot 10 — Finalisation UI, emails, compatibilité legacy et tests E2E

### Lot 0 — P0 : Sécurisation et feature flags

**Objectif :** bloquer tout paiement réel tant que la migration direct charge n'est pas complète.

Périmètre :
- feature flag `PAYMENTS_DIRECT_CHARGE`, deny par défaut ;
- suppression du fallback platform-mode comme chemin utilisable en production ;
- refus propre si `stripe_account_id` est absent ;
- aucune création de PaymentIntent dans ce lot.

Critère de fin : aucun paiement réel ne peut partir sur l'ancien modèle plateforme / destination charge.

### Lot 1 — P0 : Schéma et migrations

**Objectif :** créer le socle DB strictement additif pour l'architecture finale.

Périmètre :
- colonnes Connect sur `profiles` ;
- colonnes `stripe_connected_account_id`, `stripe_customer_id`, `stripe_payment_method_id` sur `enrollments` ;
- table / colonnes `webhook_events` compatibles Connect ;
- `mission_status`, `dispute_status`, `payment_attempts` ;
- champs J+0/J+5/J+9/J+10 et double validation virement.

Critère de fin : migrations idempotentes, types Supabase alignés, aucune suppression de donnée legacy.

Dépendance : Lot 0 pour le verrou de sécurité.

### Lot 2 — P0 : Onboarding Stripe Connect

**Objectif :** rendre `stripe_account_id` fonctionnel pour chaque freelance ; nouveaux comptes via controller properties (§8.4), sans migration brutale des comptes bêta existants.

Fichiers concernés :
- `/app/(dashboard)/parametres/` — section "Recevoir vos paiements" avec bouton d'initiation Connect ;
- `/app/api/stripe/connect/create/route.ts` — création compte Connect + stockage immédiat `acct_...` ;
- `/app/api/stripe/connect/return/route.ts` — callback retour Stripe, synchronisation statut ;
- `/app/api/stripe/connect/refresh/route.ts` — reprise si onboarding interrompu ;
- Supabase : colonnes `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted`, `stripe_currently_due`, `stripe_past_due`, `stripe_disabled_reason` dans `profiles`.

Critère de fin : après onboarding, `profiles.stripe_account_id` est renseigné et l'état Connect réel est synchronisé.

Dépendance : Lot 1.

### Lot 3 — P0 : Socle webhooks Stripe Connect

**Objectif :** mettre en place le socle webhook Connect sans créer ni traiter de paiement.

Périmètre :
- endpoint webhook Connect distinct ;
- secret de signature Connect distinct ;
- lecture de `event.account` ;
- déduplication atomique via `webhook_events.stripe_event_id` ;
- traitement `account.updated` ;
- enregistrement différé des futurs événements de paiement ;
- aucun PaymentIntent ni traitement métier de paiement.

Comportement cible :
- vérifier la signature Stripe avant toute lecture DB ou appel Stripe ;
- insérer atomiquement l'événement dans `webhook_events` avec `processing_result = 'received'` et `processed_at = NULL` ;
- répondre 200 sans retraitement si `stripe_event_id` existe déjà ;
- traiter fonctionnellement uniquement `account.updated` ;
- classer les événements de paiement futurs en `deferred_to_future_lot` ;
- classer les événements inconnus en `ignored_event_type`.

Critère de fin : endpoint Connect sécurisé, dédupliqué, idempotent, avec `account.updated` synchronisé et aucun changement de statut mission/commission/dispute.

Dépendances : Lots 1 & 2.

### Lot 4 — P0 : Enrollment client dans le contexte du compte Stripe connecté

**Objectif :**

- créer le Customer dans le compte connecté du freelance ;
- créer le SetupIntent dans ce même compte ;
- utiliser `usage = off_session` ;
- enregistrer la carte sans débit ;
- initialiser Stripe.js avec le même `stripeAccount` ;
- finaliser côté serveur en récupérant le SetupIntent dans ce même contexte ;
- persister le PaymentMethod et le compte connecté ;
- ne créer aucun PaymentIntent.

Tous les objets suivants doivent appartenir au même compte connecté :

- Customer ;
- SetupIntent ;
- PaymentMethod ;
- futurs PaymentIntents de la mission.

Chaque appel Stripe concerné doit utiliser :

```ts
{ stripeAccount: connectedAccountId }
```

Périmètre :
- résolution serveur de l'enrollment public, de la mission et du freelance ;
- vérification de readiness Connect via les champs synchronisés du Lot 2 ;
- création/récupération du Customer connecté ;
- création/récupération du SetupIntent connecté `usage: "off_session"` ;
- initialisation Stripe.js avec `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, { stripeAccount: connectedAccountId })` ou équivalent supporté ;
- finalisation serveur par retrieve du SetupIntent dans le compte connecté ;
- persistance `stripe_connected_account_id`, `stripe_customer_id`, `stripe_setup_intent_id`, `stripe_payment_method_id` sur `enrollments` ;
- traitement explicite des enrollments legacy plateforme sans migration silencieuse de carte.

Interdictions :
- aucun PaymentIntent ;
- aucun débit ;
- aucun `application_fee_amount` ;
- aucun fallback plateforme ;
- aucune réutilisation d'un Customer, SetupIntent ou PaymentMethod plateforme comme s'il appartenait au compte connecté.

Critère de fin : un enrollment client crée et finalise uniquement des objets SetupIntent/Customer/PaymentMethod dans le compte connecté du freelance, sans débit.

Dépendances : Lots 1, 2 & 3.

### Lot 5 — P0 : Liens de paiement J+0 et J+5

**Objectif :** permettre au client de payer en un clic avant tout paiement automatique.

Périmètre :
- création d'un lien public sécurisé `/pay/[token]` pour les rappels J+0/J+5 ;
- table additive `payment_action_links` stockant uniquement le hash du token ;
- association du lien à `invoice_id`, `payment_source`, `expires_at`, `consumed_at`, `revoked_at` ;
- valeurs autorisées dans ce lot : `payment_source = reminder_j0 | reminder_j5` ;
- token aléatoire fort, impossible à énumérer, jamais loggé en clair ;
- expiration par défaut : 14 jours après la création du lien ;
- ouverture répétée autorisée ; le lien n'est consommé qu'après succès Stripe confirmé par webhook ou révocation explicite ;
- création de PaymentIntent direct charge sur le compte connecté pour les liens J+0/J+5 ;
- `application_fee_amount` calculé selon le plan ;
- `payment_source = reminder_j0` ou `reminder_j5` ;
- réutilisation du Customer et PaymentMethod connectés issus du Lot 4 ;
- idempotence stricte via `payment_attempts`.

Préconditions serveur avant tout PaymentIntent J+0/J+5 :
- résoudre le lien par hash serveur ;
- vérifier l'invoice, l'enrollment actif et le compte Connect prêt ;
- vérifier `enrollment.stripe_connected_account_id = profiles.stripe_account_id` ;
- vérifier `stripe_customer_id` et `stripe_payment_method_id` sur l'enrollment ;
- vérifier `mission_status` non payé/suspendu et `external_payment_reported_at IS NULL` ;
- vérifier `balance_cents > 0` ;
- refuser si une tentative active existe (`created | processing | requires_action`) ;
- aucun fallback plateforme, aucun `transfer_data.destination`.

Erreurs publiques officielles Lot 5 :
- `invalid_payment_link`
- `expired_payment_link`
- `payment_link_revoked`
- `connect_not_configured`
- `connect_not_ready`
- `connected_account_mismatch`
- `enrollment_not_ready`
- `missing_payment_method`
- `invoice_already_paid`
- `payment_already_processing`
- `invalid_invoice_amount`
- `payment_unavailable`

Critère de fin : liens J+0/J+5 testés en direct charge test mode, sans destination charge ni platform fallback.

Dépendances : Lots 1, 2, 3 & 4.

### Lot 6 — P0 : Confirmation freelance J+9

**Objectif :** empêcher tout débit J+10 sans confirmation freelance récente.

Périmètre :
- demande J+9 au freelance uniquement ;
- actions `Toujours impayé` et `Paiement reçu` ;
- écriture de `confirmed_unpaid_at`, `confirmation_required_at`, `external_payment_reported_at` ;
- blocage si paiement externe signalé.

Critère de fin : J+10 est impossible sans `confirmed_unpaid_at` récent (< 24h).

Dépendances : Lots 1 & 5.

### Lot 7 — P0 : Direct charge automatique J+10

**Objectif :** créer le PaymentIntent off-session automatique uniquement quand toutes les conditions métier sont réunies.

Périmètre :
- PaymentIntent direct charge sur le compte connecté ;
- `off_session: true`, `confirm: true`, `application_fee_amount` ;
- montant total `balance_cents`, jamais partiel ;
- verrou `payment_attempts` pour une seule tentative active ;
- `mission_status = debit_processing` à la création ;
- `mission_status = paid` uniquement via webhook `payment_intent.succeeded`.

Critère de fin : aucun PaymentIntent J+10 sans `stripeAccount`, sans confirmation J+9 récente ou avec paiement externe signalé.

Dépendances : Lots 1, 2, 3, 4, 5 & 6.

### Lot 8 — P0 : Retries automatiques

**Objectif :** gérer uniquement les retries autorisés après un échec J+10.

Périmètre :
- un seul retry automatique à J+17 après un échec J+10 terminal `failed_retryable` ;
- aucun retry pendant `processing`, après `succeeded` ou `failed_final` ;
- pour SEPA, reprise exclusive du contexte moyen figé sur la tentative initiale ;
- pré-notification exacte J+17 au statut `sent` obligatoire avant le retry SEPA ;
- aucun fallback carte, aucun changement du moyen par défaut, aucun troisième débit ;
- aucun retry automatique pour `authentication_required`, `do_not_honor`, carte expirée, carte volée/perdue ou code inconnu ;
- arrêt immédiat si paiement externe signalé ou paiement Stripe réussi.

Critère de fin : aucun scénario ne peut dépasser un retry J+17 et aucun retry interdit n'est programmé.

Dépendance : Lot 7.

### Lot 9 — P0 : Refunds et disputes

**Objectif :** couvrir les remboursements et litiges après mise en place des paiements.

Périmètre :
- `charge.refunded` → sync refund en DB, correction invoice et commission selon §8.7, activité, alerte freelance ;
- `charge.dispute.created` → `dispute_status = open`, alerte critique Sidian, log, `mission_status` conservé ;
- `charge.dispute.closed` → résolution en DB (`won` ou `lost`) ;
- `transfer.reversed` uniquement si nécessaire et explicitement validé.

Critère de fin : refund test et dispute simulée traités dans le contexte Connect (`event.account`) sans effacer `mission_status = paid`.

Dépendances : Lots 3, 5, 7 & 8.

### Lot 10 — P1 : Finalisation UI, emails, compatibilité legacy et tests E2E

**Objectif :** durcir l'expérience, les notifications et la compatibilité avant activation live.

Périmètre :
- finalisation UI dashboard/enrollment/paiements ;
- emails transactionnels et séquences J+0/J+5/J+9/J+10 ;
- compatibilité et messages explicites pour enrollments legacy plateforme ;
- test E2E complet staging/test mode ;
- validation no-platform-fallback, no-destination-charge, no-silent-card-migration ;
- validation de bout en bout des parcours carte et SEPA actifs au MVP ;
- préparation des évolutions post-MVP (Stripe Embedded Onboarding, Fintecture, Open Banking) sans les implémenter dans le MVP.

Critère de fin : parcours complet contrat → enrollment → J+0/J+5 → J+9 → J+10 → webhook → dashboard validé en mode test, avec dettes legacy documentées.

Dépendances : Lots 0 à 9.

### Validation E2E pré-production post-Lot 10 — Test direct charge de bout en bout

**Objectif :** Vérifier le flux complet avec de vrais objets Stripe test uniquement après disponibilité de :
- enrollment dans le compte connecté ;
- liens de paiement ;
- direct charge J+10 ;
- application fee ;
- traitement webhook `payment_intent.succeeded`.

Test E2E :
1. Compte Connect test créé depuis Sidian
2. Enrollment client avec carte test `4242 4242 4242 4242` (SetupIntent off_session)
3. Lien J+0 → PaymentIntent direct charge → vérifier `stripeAccount` + `application_fee_amount`
4. Confirmation J+9 freelance → J+10 débit off-session
5. Webhook `payment_intent.succeeded` → `mission_status = paid`, commission enregistrée
6. Fonds visibles sur le compte Connect test (pas sur compte plateforme)

Aucun ID `pi_demo_*` utilisé.

---

## 11. Structure de fichiers

```
/app
  /api
    /webhooks        → Stripe (idempotency keys obligatoires)
    /crons           → Trigger.dev endpoints (surveillance échéances, séquence relance)
    /enrollment      → Flow enrollment client (public)
  /(auth)            → Pages auth freelance
  /(dashboard)       → Dashboard freelance connecté
  /enroll            → Page enrollment client (public, sans auth)
/lib
  /supabase          → Client + types générés
  /stripe            → Helpers Stripe Connect
  /integrations/billing/pennylane → OAuth B1.1 + catalogue read-only B2a
  /fintecture        → Client Fintecture (V2)
  /brevo             → Client email/SMS
  /resend            → Emails transactionnels critiques
  /validations       → Schémas Zod
  /payment-engine    → Payment Decision Engine + séquence J+0/J+5/J+9/J+10 + politique d'échec
/components
/types
```

---

## 12. Règles de développement permanentes

### Règles non négociables

- **Zod sur tous les inputs** — aucune donnée non validée ne touche la DB
- **Idempotency keys sur tous les webhooks** Stripe — vérifier avant toute écriture en DB
- **RLS Supabase activé** sur toutes les tables — un freelance ne voit jamais les données d'un autre
- **Logs structurés** sur chaque action critique (paiement, relance, webhook, anomalie)
- **Variables d'environnement** pour toutes les clés API — jamais hardcodées
- **TypeScript strict** — `strict: true` dans tsconfig, zéro `any`
- **Commission uniquement après `payment_intent.succeeded`** — jamais à la création du PI, jamais sur paiement externe
- **`enrolled_at`** — toujours vérifier que le contrat existait avant ou au moment de la finalisation de l'enrollment (`contract.created_at <= enrollment.enrolled_at`)
- **Consentement client** — aucun Setup Intent ne doit être créé avant acceptation explicite et stockage du snapshot d'autorisation
- **Annulation séquence** — si paiement externe signalé ou Stripe réussi, annuler immédiatement toutes relances/retries
- **Confirmation J+9** — aucun débit J+10 sans `confirmed_unpaid_at` datant de moins de 24h
- **Direct charge obligatoire** — tout PaymentIntent réel via `stripeAccount`, jamais sur le compte plateforme
- **Une tentative active** — contrainte DB ou verrou transactionnel sur `payment_attempts`
- **Moyen figé** — un retry reprend le provider, le type, le compte Connect, le Customer et le PaymentMethod de la tentative J+10, jamais le moyen par défaut courant
- **Pré-notification SEPA** — chaque débit SEPA exige une notification `sent` correspondant exactement au moyen, montant, devise et date planifiée
- **Retry unique** — J+10 initial + un seul retry automatique J+17, aucun troisième débit
- **Webhooks = source de vérité** — `mission_status = paid` uniquement après `payment_intent.succeeded`
- **Vocabulaire client** — aucun mot interdit (§4) dans les écrans, emails ou textes visibles par le client
- **UX client** — avant validation d'un écran client, poser la question : *"Un client raisonnable pourrait-il interpréter cet écran comme 'Mon freelance pense que je ne vais pas payer' ?"* — si oui : revoir wording, hiérarchie visuelle, message principal
- **Pennylane B2a read-only** — aucune réponse catalogue ne peut créer ou modifier une donnée métier Sidian, un lien externe ou une donnée Pennylane
- **Pagination Pennylane opaque** — transmettre le curseur sans le décoder ni l'interpréter ; gérer les limites et erreurs provider selon la documentation officielle active

### Règles Stripe Connect (non négociables)

- **Direct charge obligatoire** — tout PaymentIntent réel avec `stripeAccount` + `application_fee_amount`
- **Platform mode / destination charge interdits** — aucun PI sur le compte plateforme sans `stripeAccount`
- **Stockage immédiat** — écrire `profiles.stripe_account_id` dès que Stripe retourne `acct_...`, avant toute redirection
- **Signature webhook obligatoire** — `stripe.webhooks.constructEvent()` sur chaque requête webhook, aucune exception
- **Idempotence stricte** — clé unique par tentative dans `payment_attempts` ; `stripe_event_id` unique dans `webhook_events`
- **Commission prévisionnelle ≠ commission acquise** — enregistrée uniquement après `payment_intent.succeeded`
- **Séparation environnements** — `STRIPE_WEBHOOK_SECRET` test ≠ live, ne jamais croiser les secrets
- **Pas de débit partiel** — toujours tenter `balance_cents` en entier
- **Retry post-J10 unique** — uniquement à J+17 après un échec terminal `failed_retryable`; jamais pendant `processing`, après `succeeded` ou `failed_final`

### Règle séparation démo / réel

- Les données de démonstration ne déclenchent jamais Stripe
- Les IDs `pi_demo_*` ne sont jamais traités comme des objets Stripe réels
- L'absence de `stripe_account_id` ne signifie jamais qu'une donnée est une démo
- La séparation repose sur un marqueur explicite (champ DB) — pas sur un nom, un email, ou une heuristique

### Conventions de nommage

- Fichiers : `kebab-case`
- Composants React : `PascalCase`
- Fonctions : `camelCase`
- Variables d'environnement : `SCREAMING_SNAKE_CASE`
- Tables Supabase : `snake_case`

---

## 13. Plan de tests

### 13.1 Tests unitaires (Jest)

Couvrir en priorité :
- `lib/sidian/sequences/` — logique J+0/J+5/J+9/J+10, confirmation 24h, politique d'échec, `payment_source`
- `lib/payment-engine` — conditions pré-J+10, calcul commission, idempotence
- `lib/stripe` — direct charge params, gestion decline codes
- `lib/validations` — tous les schémas Zod
- Génération des échéances récurrentes (mensuel/trimestriel)
- Annulation séquence si paiement Stripe réussi ou externe signalé

Commande : `pnpm test`

### 13.2 Tests d'intégration (Jest + Supabase local)

- Création contrat → génération échéances → séquence J+0 déclenchée à l'échéance
- Enrollment client complet (consent → SetupIntent off_session → `mission_status = enrolled`)
- Webhook Stripe reçu en doublon → `stripe_event_id` unique → une seule action
- Paiement externe signalé → séquence annulée → 0% commission
- Confirmation J+9 absente → J+10 bloqué
- Confirmation J+9 récente → J+10 autorisé
- Freelance A ne peut pas accéder aux données Freelance B (RLS)
- Flow anti-double-débit virement : client déclare → alerte freelance → timer 24h

### 13.3 Tests end-to-end (Playwright)

Scénarios critiques :

- **Création contrat** : dashboard → nouveau contrat → email enrollment envoyé
- **Enrollment client** : lien → 4 étapes → SetupIntent 3DS2 → `enrolled`
- **Séquence nominale** : échéance → J+0 lien Stripe → J+5 relance → J+9 confirmation freelance → J+10 débit
- **Paiement lien J+0** : client paie via lien → commission enregistrée → séquence arrêtée
- **Paiement externe** : freelance signale réception → 0% commission → pas de PI
- **Flow anti-double-débit virement** : anomalie → suspension → décision freelance
- **Edge case couverture enrollment** : contrat créé strictement après `enrolled_at` → bloqué ; même timestamp autorisé

Commande : `pnpm test:e2e`

### 13.4 Scénarios de tests obligatoires

> Chaque scénario doit être couvert par au moins un test automatisé (unitaire ou intégration) ou un test E2E documenté avant mise en production.

| # | Scénario | Résultat attendu |
|---|---|---|
| 1 | Paiement externe signalé **avant J+0** | Séquence annulée, 0% commission, aucun PI |
| 2 | Paiement via **lien J+0** | Direct charge réussie, commission enregistrée, relances stoppées |
| 3 | Paiement via **lien J+5** | Idem J+0, `payment_source = reminder_j5` |
| 4 | Confirmation freelance **absente à J+9** | J+10 **bloqué**, aucun PI créé |
| 5 | Confirmation présente + **paiement J+10 réussi** | `mission_status = paid` via webhook, commission OK |
| 6 | **Échec J+10 retryable** | `failed_retryable`, un seul retry automatique à J+17 |
| 7 | **`authentication_required`** | `awaiting_client_action`, lien client, aucun retry auto |
| 8 | **Carte expirée** | `failed_final`, demande nouvelle carte |
| 9 | **Double webhook** (`payment_intent.succeeded` ×2) | Une seule transition `paid`, une commission |
| 10 | **Double clic / double cron** | Idempotence → une seule tentative active |
| 11 | Paiement volontaire (lien) **pendant qu'un retry est programmé** | Succès → retries annulés |
| 12 | **Litige créé** après paiement réussi | `mission_status = paid`, `dispute_status = open` |
| 13 | **Remboursement** après commission | Commission / `application_fee` selon politique §8.7 — non codée sans validation finance |
| 14 | **Tentative de double débit** | Garde DB + idempotence → refus propre |
| 15 | Paiement externe signalé **juste avant J+10** | J+10 bloqué malgré `confirmed_unpaid_at` récent |
| 16 | SEPA encore `processing` à J+17 | Aucun retry, aucun nouveau PaymentIntent |
| 17 | Retry SEPA sans pré-notification J+17 exacte `sent` | Débit bloqué |
| 18 | Moyen par défaut changé après J+10 | Retry avec le moyen figé initial ou refus s'il est inexploitable, jamais de fallback |
| 19 | Retry J+17 échoué | État terminal pour le cycle, aucun troisième débit |

### 13.5 Dogfood test (Cowork)

Avant chaque déploiement en staging :
1. Lancer Cowork sur l'URL de staging
2. Tester la création de contrat + enrollment complet de bout en bout
3. Tester le dashboard freelance de A à Z
4. Capturer les incohérences UI / bugs de navigation / états vides

### 13.6 Security review (prompt Cursor dédié)

Avant chaque PR mergée, passer ce prompt dans Cursor :

```
Analyse ce code en cherchant :

1. SÉCURITÉ : injection, accès non autorisé, données exposées dans les logs,
   clés API en dur, RLS manquant, données bancaires stockées
2. EDGE CASES : montant 0, webhook manquant, contrat strictement postérieur à enrolled_at,
   enrollment révoqué en cours de séquence, double webhook Stripe,
   paiement reçu entre J+0 et J+9 sans annulation de séquence
3. VIOLATIONS RÈGLES SIDIAN : idempotency manquante, Zod absent sur un input,
   commission prise avant payment_intent.succeeded, direct charge absent (stripeAccount),
   débit partiel tenté, plus d'un retry, J+10 sans confirmed_unpaid_at récent,
   mission_status = paid sans webhook, enrolled_at non vérifié
4. PERFORMANCE : N+1 queries Supabase, cron job sans queue

Liste chaque problème avec : fichier + ligne + description + correction recommandée.
Sois exhaustif.
```

---

## 14. Review automatique Cursor (toutes les 5-10 min)

Cursor vérifie cette liste à chaque sauvegarde de fichier ou toutes les 5-10 minutes :

- [ ] Les nouveaux endpoints ont-ils un schéma Zod ?
- [ ] Les nouveaux webhooks ont-ils une idempotency key ?
- [ ] Les nouvelles tables Supabase ont-elles des RLS policies ?
- [ ] Les nouvelles actions critiques sont-elles loggées ?
- [ ] La commission est-elle enregistrée uniquement après `payment_intent.succeeded` ?
- [ ] Le PaymentIntent utilise-t-il `stripeAccount` (direct charge) ?
- [ ] Customer / SetupIntent / PaymentMethod sont-ils créés sur le compte connecté (§8.5) ?
- [ ] Les webhooks Connect utilisent-ils `event.account` pour récupérer les objets (§18) ?
- [ ] J+10 est-il bloqué sans `confirmed_unpaid_at` récent (< 24h) ?
- [ ] Une seule tentative active par mission est-elle garantie ?
- [ ] `mission_status = paid` est-il uniquement posé par webhook ?
- [ ] `dispute_status` est-il séparé de `mission_status` ?
- [ ] `enrolled_at` est-il vérifié avant de traiter un contrat ?
- [ ] L'acceptation client est-elle stockée avant tout Setup Intent ?
- [ ] La séquence est-elle annulée si paiement Stripe réussi ou externe signalé ?
- [ ] Un écran client contient-il un mot interdit (§4 vocabulaire) ?
- [ ] Un écran client peut-il être perçu comme un système anti-impayé ?
- [ ] Les variables d'environnement sont-elles dans `.env.example` ?
- [ ] TypeScript compile sans erreur (`pnpm typecheck`) ?
- [ ] Les tests passent (`pnpm test`) ?

**Si un point est rouge → bloquer et corriger avant de continuer.**

---

## 15. Checklist déploiement

### Pré-deploy

```
[ ] pnpm typecheck → zéro erreur
[ ] pnpm test → zéro failing test
[ ] pnpm test:e2e → scénarios critiques au vert
[ ] Dogfood Cowork sur staging → zéro bug bloquant
[ ] Security review prompt passé sur les fichiers modifiés
[ ] Migrations Supabase appliquées + RLS vérifiées
[ ] Variables d'environnement à jour sur Vercel
[ ] Trigger.dev crons actifs et testés
```

### Post-deploy

```
[ ] Webhook Stripe actif et reçu en prod
[ ] Trigger.dev crons actifs (surveillance échéances)
[ ] Contrat test + enrollment complet avec carte de test Stripe en prod
[ ] Séquence J+0/J+5 reçue en prod (liens Stripe)
[ ] Confirmation J+9 freelance testée
[ ] Paiement J+10 testé en mode test Stripe (direct charge)
[ ] Dashboard freelance accessible et données correctes
```

### Avant premier paiement live (bloquant)

Voir §19 — Checklist avant premier paiement live. Toutes les cases doivent être cochées avant d'activer le mode live Stripe.

---

## 16. Variables d'environnement requises

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe Connect
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Brevo
BREVO_API_KEY=

# Resend
RESEND_API_KEY=

# Trigger.dev
TRIGGER_API_KEY=

# App
NEXT_PUBLIC_APP_URL=

# --- V2 ---
# Fintecture
FINTECTURE_APP_ID=
FINTECTURE_APP_SECRET=

# Pennylane optionnel — OAuth B1.1 + catalogue read-only B2a
PENNYLANE_CLIENT_ID=
PENNYLANE_CLIENT_SECRET=
PENNYLANE_REDIRECT_URI=
PENNYLANE_OAUTH_STATE_SECRET=
INTEGRATION_CREDENTIALS_ENCRYPTION_KEY=
```

`STRIPE_CONNECT_WEBHOOK_SECRET` est distinct de `STRIPE_WEBHOOK_SECRET`.
Le webhook plateforme et le webhook Connect sont deux endpoints séparés, avec deux secrets séparés par environnement. Aucune valeur réelle ne doit être stockée dans `.env.example`.

---

## 17. Points de vigilance permanents

| # | Risque | Mitigation |
|---|---|---|
| 1 | Commission enregistrée avant `payment_intent.succeeded` | Commission DB écrite uniquement dans le handler webhook `payment_intent.succeeded` |
| 2 | Webhook Stripe doublon → double débit | `webhook_events.stripe_event_id` UNIQUE + idempotency sur `payment_attempts` |
| 3 | Contrat créé strictement après `enrolled_at` débité | Exiger `contract.created_at <= enrollment.enrolled_at` ; égalité autorisée, sinon nouvel enrollment/consentement |
| 4 | Paiement externe ou Stripe réussi non détecté | Webhook + `external_payment_reported_at` → annulation séquence immédiate |
| 5 | Freelance A voit les données Freelance B | RLS Supabase — tester après chaque migration |
| 6 | Enrollment révoqué pendant une séquence active | Vérifier `enrollment.status = active` avant chaque étape |
| 7 | J+10 sans confirmation freelance récente | Bloquer si `confirmed_unpaid_at` > 24h ou NULL |
| 8 | Plus d'un retry post-J+10 | Un seul retry J+17, claim atomique et filiation avec la tentative initiale |
| 9 | Débit partiel | Toujours `amount = balance_cents` — jamais de montant partiel |
| 10 | PI créé sur compte plateforme (pas direct charge) | `stripeAccount` obligatoire — refus si absent |
| 11 | `stripe_account_id` présent ≠ compte prêt | Vérifier `charges_enabled` ET `payouts_enabled` ET `currently_due` vide |
| 12 | Tentative active dupliquée (race cron) | Contrainte unique ou `FOR UPDATE` sur mission avant création PI |
| 13 | Litige efface le statut paid | `dispute_status` séparé — `mission_status` reste `paid` |
| 14 | `authentication_required` → retry auto | `awaiting_client_action` — aucun retry tant que client n'a pas agi |
| 15 | Commission sur virement externe | 0% si `external_payment_reported_at` renseigné |
| 16 | RGPD — consentement client | Texte + timestamp + IP + user agent + snapshot avant SetupIntent |
| 17 | IDs démo (`pi_demo_*`) traités comme réels | Séparation via marqueur explicite en DB |
| 18 | Customer / PM créés sur compte plateforme | Tous objets Stripe sur `stripe_connected_account_id` (§8.5) |
| 19 | Webhook traité sans `event.account` (Connect) | Récupérer PI/Charge via `stripeAccount = event.account` (§18) |
| 20 | `application_fee` supposée remboursée auto | Politique explicite §8.7 — remboursement total / prorata / litige |
| 21 | Retry SEPA pendant `processing` | `processing` bloque tout retry ; attendre un événement terminal |
| 22 | Retry avec le moyen par défaut courant | Utiliser exclusivement le contexte figé de la tentative J+10 |
| 23 | Pré-notification J+10 réutilisée pour J+17 | Exiger une notification J+17 exacte au statut `sent` |
| 24 | Troisième débit automatique | Cycle terminé après l'échec du retry J+17 |

---

## 18. Webhooks Stripe — obligations

> Les webhooks sont la **seule source de vérité** du résultat final. Voir §7.1 pour la politique complète.

### Webhooks Connect vs compte plateforme

Avec des **direct charges**, les événements de paiement sont produits **sur les comptes connectés** (`payment_intent.*`, `charge.*`, remboursements, litiges). Le système **ne doit pas** écouter uniquement le compte plateforme Sidian.

**Configuration obligatoire :**

1. **Endpoint webhook Connect** — recevant les événements émis **depuis** les comptes connectés (Stripe Dashboard → Connect → Webhooks, ou API `webhookEndpoints.create` avec `connect: true`).
2. **Endpoint webhook plateforme** (optionnel mais recommandé) — pour `account.updated` et événements sans `event.account`.
3. Secrets webhook **distincts** par endpoint et par environnement (test / live).

**Traitement de chaque événement Connect :**

```text
1. Vérifier la signature Stripe (constructEvent) — AVANT tout traitement
2. Insérer atomiquement event.id dans webhook_events avec processing_result = 'received'
3. Si conflit unique sur stripe_event_id, répondre 200 sans retraitement
4. Lire stripe_connected_account_id depuis event.account
5. Récupérer l'objet Stripe (PaymentIntent, Charge, Refund, Dispute)
   en passant stripeAccount = event.account — JAMAIS sur le compte plateforme seul
6. Appliquer la logique métier
7. Mettre à jour processing_result et processed_at
```

L'insertion préalable dans `webhook_events` signifie uniquement que l'événement
a été reçu et réservé pour déduplication. Elle ne signifie pas que le traitement
métier a réussi : seul `processing_result` terminal et `processed_at` renseigné
attestent du résultat final.

**Ne jamais supposer** qu'un `pi_...`, `ch_...` ou `re_...` reçu via webhook Connect existe ou est lisible sur le compte plateforme.

### Table de déduplication

```sql
webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  stripe_connected_account_id TEXT,  -- event.account ; NULL si événement plateforme pur
  event_type TEXT NOT NULL,
  stripe_object_id TEXT,             -- id objet principal (data.object.id)
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NULL,
  processing_result TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Ne jamais traiter deux fois le même `stripe_event_id`.
Le résultat `duplicate` peut être un résultat applicatif ou de log sans seconde
ligne persistée, puisque le doublon entre en conflit sur `stripe_event_id`.

Valeurs `processing_result` autorisées au minimum :
- `received`
- `processing` — état interne transitoire de claim concurrent ; jamais résultat terminal
- `processed`
- `duplicate`
- `orphan_connected_account`
- `deferred_to_future_lot`
- `ignored_event_type`
- `retryable_error`
- `permanent_error`
- `success` / `skipped` / `error` — valeurs legacy temporairement autorisées pendant la transition

### Événements à gérer

| Event | Priorité | Action requise |
|---|---|---|
| `payment_intent.succeeded` | P0 | `mission_status = paid`, commission enregistrée, relances/retries annulés |
| `payment_intent.payment_failed` | P0 | Appliquer politique d'échec (§7.1), mettre à jour `payment_attempts` |
| `payment_intent.processing` | P0 | `mission_status = debit_processing`, notification freelance |
| `payment_intent.requires_action` | P0 | `mission_status = awaiting_client_action`, lien auth client |
| `charge.dispute.created` | P0 | `dispute_status = open` — **`mission_status` reste `paid`** |
| `charge.dispute.closed` | P0 | `dispute_status = won` ou `lost` |
| `charge.refunded` | P0 | Traitement selon politique commission §8.7 ; récupérer Charge sur compte Connect (`event.account`) |
| `account.updated` | P0 | Sync `charges_enabled`, `payouts_enabled`, `requirements.currently_due` |
| `mandate.updated` | P2 (V2 SEPA) | Invalider mandat révoqué |

### Événements actuellement gérés (état code juillet 2026)

| Event | Persisté dans `webhook_events` | Action DB |
|---|---|---|
| `payment_intent.succeeded` | Oui | `invoices.status = debited`, `payment_intents.status = succeeded` — **à migrer vers `mission_status = paid`** |
| `payment_intent.payment_failed` | Oui | `payment_intents.status = failed`, `failure_reason` — **à migrer vers politique d'échec §7.1** |

### Règles permanentes webhook

- Signature Stripe obligatoire sur chaque requête (`stripe.webhooks.constructEvent`) — **avant** toute lecture DB ou appel API Stripe
- `STRIPE_WEBHOOK_SECRET` (plateforme) et secret Connect **distinct** vérifiés à chaque démarrage — 500 immédiat si absent
- Idempotence via `webhook_events.stripe_event_id` unique
- Pour événements Connect : utiliser `event.account` comme `stripe_connected_account_id` et `{ stripeAccount: event.account }` pour récupérer les objets
- La route `POST /api/stripe/webhook` (et route Connect dédiée si séparée) est publique — aucun middleware d'auth ne doit l'intercepter
- Environnements séparés : secret local Stripe CLI ≠ secret Dashboard test ≠ secret Dashboard live
- `webhook_events` row insérée atomiquement avant le traitement métier avec `processing_result = 'received'`
- `processed_at` reste NULL tant que le traitement n'est pas terminal
- URL configurée chez Stripe doit pointer vers le domaine réel déployé (jamais `localhost` en production)
- Endpoint Connect configuré pour recevoir les événements des comptes connectés — pas seulement le compte plateforme

---

## 19. Checklist avant premier paiement live

> **Aucun paiement live avant validation complète de cette checklist.**

```
CONNECT
[ ] Compte Connect créé depuis Sidian (UI Paramètres)
[ ] profiles.stripe_account_id stocké immédiatement
[ ] charges_enabled = true vérifié
[ ] payouts_enabled = true vérifié
[ ] Onboarding terminé (details_submitted = true)
[ ] requirements.currently_due vide

PLATFORM MODE / DIRECT CHARGE
[ ] Platform fallback et destination charge supprimés
[ ] Chaque PI test utilise stripeAccount (direct charge)
[ ] application_fee_amount visible dans Stripe Dashboard Connect
[ ] Test : J+10 avec stripe_account_id = null → refus propre (pas de PI créé)

PAIEMENT TEST
[ ] Direct charge test réussie (stripeAccount présent)
[ ] Lien J+0 test → payment_source = reminder_j0, commission OK
[ ] application_fee_amount visible dans Stripe Dashboard
[ ] Webhook payment_intent.succeeded → mission_status = paid (pas avant)
[ ] Idempotence testée (double webhook → une seule commission)
[ ] Échec insufficient_funds → failed_retryable, retry programmé
[ ] Retry automatique unique à J+17, calculé depuis la même échéance métier en Europe/Paris
[ ] Retry SEPA bloqué sans pré-notification J+17 exacte au statut sent
[ ] Retry SEPA reprend le moyen figé J+10, sans fallback carte ni autre SEPA
[ ] Échec du retry J+17 → aucun troisième débit automatique
[ ] Échec authentication_required → awaiting_client_action, pas de retry auto
[ ] Échec expired_card → failed_final
[ ] J+10 sans confirmed_unpaid_at récent → bloqué
[ ] Refund testé → commission corrigée
[ ] Dispute simulée → dispute_status = open, mission_status = paid

WEBHOOKS
[ ] STRIPE_WEBHOOK_SECRET configuré sur Vercel (test + live séparés)
WEBHOOKS CONNECT
[ ] Endpoint webhook Connect configuré (événements depuis comptes connectés)
[ ] Secret Connect distinct du secret plateforme
[ ] Test : PI direct charge → webhook reçu avec event.account = acct_...
[ ] Handler récupère PaymentIntent via stripeAccount = event.account
[ ] stripe_event_id + stripe_connected_account_id + stripe_object_id persistés

WEBHOOKS GÉNÉRAUX
[ ] URL webhook configurée chez Stripe → domaine déployé réel
[ ] webhook_events reçoit bien les rows après un PI test
[ ] Aucun middleware n'intercepte /api/stripe/webhook

DONNÉES
[ ] Aucun ID pi_demo_* en base de production
[ ] Isolation freelance A/B vérifiée (RLS)
[ ] Variables d'env test/live vérifiées et séparées

SCHÉMA & MIGRATIONS (dettes Lot 1 — bloquantes avant prod)
[ ] RLS testée RÉELLEMENT avec les rôles Supabase anon / authenticated / service_role
    (enforcement par rôle, pas seulement DDL/catalog) — la validation PGlite du Lot 1
    ne couvre PAS l'enforcement par rôle (superuser unique).
[ ] Baseline CANONIQUE créée depuis le vrai schéma Supabase (supabase db dump),
    puis Lot 0 + Lot 1 rejoués dessus via `supabase db reset` (Docker).
    Le baseline PGlite reconstruit (lib/payments/__tests__/sql/baseline-schema.sql)
    est un environnement de validation SQL intermédiaire — JAMAIS le schéma canonique.
```

---

## 20. Planning — 9 jours (note temporaire)

> *Datée du 5 juillet 2026 — à retirer une fois le jalon atteint.*

**Objectif du jalon paiement MVP :**
- Carte et SEPA Direct Debit actifs, SetupIntent off_session et consentement adapté au moyen
- Schéma + Stripe Connect (Lots 1 & 2) — controller properties cible, Express hérité bêta uniquement
- **Direct charges** fonctionnelles (liens J+0/J+5 + débit J+10)
- Commission automatique sur tout paiement Stripe réussi
- Confirmation freelance J+9 + politique d'échec
- Webhooks fiables (signature + idempotence + déduplication)
- Table `payment_attempts` + verrouillage
- Pré-notification SEPA exacte avant chaque débit et retry SEPA unique J+17
- Refunds/disputes minimums (Lot 9)
- Test E2E en mode test Stripe en validation pré-production post-Lot 10
- Bêta privée encadrée

**Hors périmètre du jalon :**
- Fintecture / Open Banking
- Stripe Embedded Onboarding (post-Lot 10 / V1.1)
- Facturation de commission sur virements externes
- Reporting financier avancé
- Nouvelles fonctions non critiques

---

## 20 bis. Historique des décisions paiement révisées

| Décision | Ancienne version | Nouvelle version | Date | Raison |
|---|---|---|---|---|
| Moyens de paiement MVP | Carte uniquement, SEPA préparé mais désactivé | Carte et SEPA Direct Debit actifs au MVP, Stripe restant l'unique PSP ; carte recommandée par défaut, sans seuil automatique | Juillet 2026 | Parcours SEPA implémenté par lots et validé sans régression du parcours carte |
| Retry SEPA | Règle absente ou limitée au parcours carte avec plusieurs retries | Retry SEPA automatique unique à J+17, avec nouvelle pré-notification exacte et aucun troisième débit | Juillet 2026 | Aligner l'asynchronisme SEPA, l'idempotence et le calendrier métier |
| Recommandation moyen | `mvp_card_only` | `recommendedType = card`, `availableTypes = [card, sepa_debit]`, `ruleVersion = mvp_card_default_with_sepa` | Juillet 2026 | Préserver la carte par défaut sans désactiver le choix SEPA |
| Couverture contrat/enrollment | Contrat supposé postérieur à `enrolled_at` | L'enrollment couvre les contrats créés avant ou au même instant ; un contrat strictement postérieur exige un nouvel enrollment/consentement | 13 juillet 2026 | Aligner la règle sur le parcours réel : le contrat existe avant la finalisation du consentement client |

### Lot C1 — durcissement du moteur carte critique

- Le seuil J+10 est le début du jour métier J+10 en `Europe/Paris`, puis comparé comme instant UTC ; le calcul est indépendant de la timezone du serveur et couvre les transitions DST.
- Le claim J+10 ne réutilise que la tentative `automatic_j10` de même facture, même clé métier/version, même compte Connect, cycle initial et statut compatible. Toute autre source, clé, compte, cycle ou tentative manuelle est refusée sans créer de PaymentIntent.
- `enrollment_payment_methods` prévaut dès qu'il contient une ligne. Un moyen par défaut inactif, révoqué, en échec, pending, non-Stripe, incomplet ou rattaché à un autre compte Connect bloque explicitement ; une erreur de lecture du référentiel bloque aussi. Le fallback vers les colonnes enrollment legacy n'est permis que si la table est réellement absente ou si le référentiel de cet enrollment est vide.
- Une transition webhook critique qui échoue en base lève une erreur : l'événement reste retryable et ne peut pas être marqué `processed`. L'email `requires_action` n'est envoyé qu'après confirmation des écritures DB.
- Les mutations financières authentifiées directes sont retirées pour `invoices`, `enrollments`, `payment_intents` legacy et, si elle existe, `enrollment_payment_methods`. Les lectures tenant-scoped restent disponibles ; les écritures passent par service role, route serveur ou RPC contrôlée.
- Limites résiduelles : la finalisation `succeeded` conserve sa RPC transactionnelle existante ; les transitions non terminales restent composées de plusieurs écritures contrôlées et reposent sur le retry webhook pour converger après une erreur intermédiaire.

Toute évolution actée dans `docs/SIDIAN_MASTER_REFERENCE.md` ou un ADR devait être
répercutée dans ce fichier avant l'ouverture d'un lot de code qui la rendrait
contradictoire. *(Phrase historique — ce fichier n'est plus la source de vérité opérationnelle, cf. rappel d'archivage en fin de document.)*

---

## 21. Tailwind réglementaire

**Réforme e-facturation obligatoire France :**
- **1er sept 2026** : toutes les entreprises doivent pouvoir recevoir des e-factures via PDP certifiée
- **1er sept 2027** : obligation d'émettre des e-factures pour les TPE/micro-entreprises

Sidian est nativement aligné — le modèle de contrat manuel reste indépendant des outils de facturation. Le catalogue Pennylane B2a reste optionnel et read-only côté provider ; l'import contrôlé B2b et la sécurisation B2c sont livrés. Toute synchronisation automatique, tout webhook Pennylane ou toute écriture vers Pennylane relève d'un lot futur explicitement validé.

---

*Dernière mise à jour : 13 juillet 2026 — alignement du parcours manuel avec Pennylane OAuth B1.1, catalogue B2a, import B2b et sécurisation B2c livrés*
*Source : décisions MVP validées + architecture paiement MVP finale (direct charge, J+0/J+5/J+9/J+10/J+17) + retours bêta-testeurs + règles de build Cursor + audit Stripe Connect/SEPA (juillet 2026)*
*Précédent : `app/SIDIAN_CURSOR.md` (obsolète sur la séquence de relance et le modèle de commission — ne plus utiliser comme référence paiement ; supprimé du nouveau projet le 14 juillet 2026)*

---

> ## ⚠️ Rappel d'archivage
> L'intégralité du contenu ci-dessus est historique et non normative.
> Aucune règle produit, technique ou opérationnelle ne doit être extraite de ce fichier pour une nouvelle implémentation, y compris par recherche sémantique sur un passage isolé.
> Seuls `SIDIAN_01_FONDATIONS_V2.md`, `SIDIAN_02_PRD_V2.md` et `SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` font autorité — voir `AGENTS.md`.
