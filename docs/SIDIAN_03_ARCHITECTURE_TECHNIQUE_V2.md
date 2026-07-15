# SIDIAN — 03 · ARCHITECTURE TECHNIQUE (V2)
## Modèle de données, machines d'état, intégrations — le comment, jamais le pourquoi

**Statut :** document purement technique. Toute justification produit ou métier renvoie à 02 (PRD) ; toute justification de contrainte externe renvoie à 01 (Fondations). Réécrit intégralement le 14 juillet 2026.

**Stack conservée :** Next.js / Supabase (Postgres + RLS) / Stripe Connect. Développement Cursor.

---

## 1. Modèle de données — entités et champs clés

**Note de vocabulaire :** `creance` est un nom d'entité interne. Il n'apparaît jamais tel quel dans l'interface ou la communication vue par le prestataire ou le client — le terme produit est « paiement à recevoir » (cf. 02, §1). Toute chaîne de caractères destinée à l'affichage doit utiliser le vocabulaire produit, jamais le nom de la table.

**Périmètre :** les entités ci-dessous sont celles du MVP tel que scopé en 02 §8. Tout ce qui relève de l'agrégation bancaire est délibérément absent d'ici et regroupé en §13 (Architecture différée), pour que ce schéma reflète fidèlement ce qui est réellement construit maintenant.

### `prestataire`
`id`, `nom`, `email`, `subscription_status` (enum : `trialing` / `active` / `past_due` / `cancelled`), `pricing_version` (texte libre, ex. `early_access_49`, pour tracer quelle offre s'applique sans coder les futurs plans en dur), `subscription_started_at`, `early_access_price_locked_until` (nullable), `profil_agent_defaut` (contrôle/délégation), `created_at`. **Le prix commercial n'est jamais utilisé comme logique métier dans le code du suivi des paiements** — la grille Starter/Pro/Business codée en dur d'une version antérieure est supprimée ; la tarification future (cf. 02 §6) reste une hypothèse commerciale, pas un contrat technique actuel. Aucun quota d'utilisateurs, de clients ou d'automatisation lié à un plan n'est codé au MVP.

**Opérateur unique au MVP :** une micro-agence cible peut compter 2 à 5 personnes (cf. 01 §3, 02 §2), mais le MVP ne construit pas de système de membres et de rôles. Au lancement, un compte `prestataire` possède un seul utilisateur principal (le fondateur ou responsable des règlements) — aucune architecture RBAC n'est introduite ; les fonctions multi-utilisateurs sont reportées au pricing post-validation et au backlog produit.

### `client_payeur`
`id`, `prestataire_id` (FK), `nom`, `email`, `historique_paiements_reguliers` (compteur, sert de déclencheur pour PRD §4.4), `created_at`. **Ne référence aucune autorisation directement** (cf. `payment_authorization` ci-dessous pour la raison).

### `creance` — **l'entité pivot du système**
`id`, `prestataire_id` (FK), `client_payeur_id` (FK), `montant`, `devise`, `origine` (enum : `facture_externe` / `acompte` / `echeancier` / `abonnement` / `import_manuel`), `reference_externe` (nullable — ex. numéro de facture Pennylane, purement informatif, jamais un pointeur fonctionnel), `date_echeance`, `etat` (cf. machine d'état §2.1), `created_at`, `updated_at`. **Le lien de paiement est généré et accessible dès la création de la créance** (cf. §7, clarification sur la disponibilité du lien) — l'état et le dossier de suivi ne conditionnent que l'envoi actif par l'agent, jamais la possibilité pour un client volontaire de payer plus tôt.

### `tentative_paiement` — distincte du règlement confirmé
`id`, `creance_id` (FK), `montant`, `moyen` (enum : `carte` / `sepa_core`), `source` (enum : `lien_agent` / `prelevement_auto`), `stripe_payment_intent_id`, `etat` (cf. machine d'état dédiée §2.2), `created_at`. **Toute tentative, y compris échouée, crée une ligne ici — jamais dans `paiement`.**

### `paiement` — règlements confirmés uniquement
`id`, `creance_id` (FK), `tentative_paiement_id` (FK nullable — nul si détecté hors Sidian, cf. §13), `montant`, `source` (enum : `lien_agent` / `prelevement_auto` / `detecte_hors_sidian`), `created_at`. **Une créance peut avoir plusieurs lignes de `paiement` en cas de règlement partiel — la somme des paiements confirmés détermine le solde, jamais un flag binaire.** Une ligne référence directement une seule `creance_id` ; l'allocation multi-créances (virement groupé) n'est pas construite tant qu'aucun usage réel ne le justifie.

### `payment_authorization` — généralisation du « mandat »
`id`, `client_payeur_id` (FK), `prestataire_id` (FK), `type` (enum : `card_off_session` / `sepa_core_mandate`), `stripe_payment_method_id`, `stripe_mandate_id` (nullable, uniquement pour `sepa_core_mandate`), `etat` (cf. machine d'état dédiée §2.3), `is_default` (bool), `authorized_at`, `authorization_text_version`, `authorization_channel`, `revoked_at` (nullable). Une autorisation est toujours scopée `client_payeur × prestataire`, jamais globale.

**Correction d'une dépendance circulaire :** la version précédente stockait un `autorisation_active_id` sur `client_payeur`, dupliquant une information déjà portée par `payment_authorization.etat`, avec un risque réel d'incohérence entre les deux (l'un dit `ACTIVE`, l'autre pointe ailleurs ou vers rien). L'autorisation active se retrouve désormais par requête, garantie par contrainte plutôt que par duplication :
```sql
-- Au plus une autorisation par défaut par couple client × prestataire,
-- mais plusieurs autorisations peuvent coexister à l'état ACTIVE
-- (ex. carte de secours en plus du compte bancaire principal).
CREATE UNIQUE INDEX ON payment_authorization (client_payeur_id, prestataire_id)
WHERE is_default = true;
```
**Pour le MVP**, l'interface n'expose et ne gère qu'une seule autorisation à la fois (la `is_default`) — la possibilité technique d'en coexister plusieurs est permise dans le modèle pour éviter une migration douloureuse plus tard, sans être construite côté produit maintenant.

### `regle`
`id`, `prestataire_id` (FK), `client_payeur_id` (nullable — null = règle par défaut du prestataire), `parametre` (enum, cf. §4), `valeur`, `origine` (défaut/instruction_naturelle), `libelle_instruction_origine` (texte brut de l'instruction si applicable, conservé pour audit — ex. « sois plus souple avec Marie »), `actif` (bool), `created_at`.

### `conversation` / `message`
`conversation_id`, `creance_id` (nullable), `client_payeur_id` (nullable), `emetteur` (agent/prestataire/client), `contenu`, `canal` (email/interface), `actor_type` (`human` / `sidian_agent` / `system` / `external_integration`), `created_at`. Immuable — aucune suppression, seulement des ajouts. Sert de trace probatoire (cf. 01, contrainte de prescription). **Relation explicite avec le dossier de suivi :** rattachées à `creance_id`, jamais à une seconde FK dupliquée vers `dossier_suivi` — puisqu'une créance possède au plus un dossier de suivi principal au MVP (cf. `dossier_suivi.creance_id` unique), celui-ci se retrouve par jointure simple.

### `dossier_suivi` — le fil relationnel (§2.4), auparavant référencé sans jamais être défini, et nommé `collection_case` dans une version antérieure (renommé pour cohérence avec le reste du vocabulaire français des entités)
`id`, `creance_id` (FK, unique — une créance possède un dossier de suivi principal au MVP), `etat` (cf. machine d'état dédiée §2.4), `last_client_activity_at` (nullable), `last_agent_action_at` (nullable), `next_action_at` (nullable), `escalation_reason` (nullable, rempli à la transition vers `ESCALADE_HUMAINE`), `created_at`, `updated_at`, `clos_at` (nullable).

### `approval_request` — les demandes d'approbation créées par le registre encadré (§10), auparavant référencées sans jamais être définies
`id`, `prestataire_id` (FK), `creance_id` (nullable), `type` (enum : `formal_action` / `rule_change` / `depassement_seuil` / autre), `requested_by_actor_type`, `requested_by_provider` (nullable, cf. traçabilité §10), `payload` (contexte structuré destiné au prestataire pour décider), `status` (`pending` / `approved` / `rejected` / `expired`), `approved_by` (nullable), `decided_at` (nullable), `created_at`, `expires_at` (nullable). Cette table reste simple — aucun moteur générique complexe d'approbation n'est nécessaire au MVP.

### `audit_log` — trace systématique de toute action du registre encadré (§4, §6), auparavant mentionnée sans entité dédiée
`id`, `actor_type`, `actor_provider` (nullable), `actor_model` (nullable), `action`, `entity_type`, `entity_id`, `metadata` (contexte structuré, incluant le cas échéant la règle appliquée), `created_at`.

### `processed_webhook_event` — déduplication des événements Stripe (cf. §3)
`id` (= `event_id` Stripe, clé primaire), `type`, `processed_at`. Toute réception d'un webhook Stripe vérifie d'abord l'absence de ce `event_id` avant tout traitement — c'est le mécanisme concret qui rend l'idempotence du §3 vérifiable, pas seulement énoncée en principe.

---

## 2. Machines d'état — quatre machines séparées, jamais mélangées

**Principe de correction par rapport à une version antérieure :** une seule machine d'état mélangeait l'état financier de la créance, la source du règlement, la proposition d'autorisation et le suivi relationnel. Conséquence concrète du mélange : un simple échec de carte pouvait faire glisser l'état affiché d'une créance vers quelque chose qui ressemblait à un problème financier, alors que rien n'avait changé sur la créance elle-même. Ces quatre dimensions appartiennent à quatre domaines distincts et sont donc modélisées séparément.

### 2.1 Créance — reste volontairement simple

```
BROUILLON
  │
  ▼
OUVERTE                         (échéance fixée, notices informatives actives)
  │
  ├──[paiement partiel confirmé]──► PARTIELLEMENT_RÉGLÉE ──[solde atteint]──► RÉGLÉE
  ├──[paiement total confirmé]────► RÉGLÉE
  ├──[litige détecté]─────────────► EN_LITIGE ──[résolution]──► OUVERTE ou ANNULÉE ou RÉGLÉE
  ├──[prestataire annule]─────────► ANNULÉE
  └──[silence prolongé, prestataire décide]──► IRRÉCOUVRABLE
```

`RÉGLÉE`, `ANNULÉE`, `IRRÉCOUVRABLE` sont terminaux. La créance ne connaît ni la source du règlement, ni le nombre de tentatives, ni l'existence d'une autorisation — ces informations vivent dans les machines ci-dessous et sont simplement consultées en jointure.

### 2.2 Tentative de paiement — un essai, pas un règlement

```
CRÉÉE
  ├──► NÉCESSITE_ACTION_CLIENT   (authentification requise, ex. 3D Secure)
  ├──► EN_TRAITEMENT             (SEPA : délai de plusieurs jours ouvrés avant confirmation)
  ├──► RÉUSSIE                   (déclenche la création d'une ligne `paiement`, cf. §1)
  ├──► ÉCHOUÉE                   (provision insuffisante, carte expirée, refus banque…)
  └──► ANNULÉE
```

**Règle verrouillée, non négociable :** une tentative ne passe à `RÉUSSIE` que sur réception d'un événement fiable du prestataire de paiement (webhook Stripe), jamais par simple écoulement d'un délai. Pour le SEPA en particulier, où la confirmation définitive prend plusieurs jours ouvrés, l'état `EN_TRAITEMENT` peut durer — et c'est très bien ainsi. **Il est interdit de faire passer une tentative en `RÉUSSIE` sur la seule base d'un nombre de jours écoulés sans incident.** Le tableau de bord peut présenter les montants selon trois statuts d'affichage distincts (« paiement initié », « en cours de confirmation », « confirmé ») sans qu'aucun des deux premiers ne corresponde à une confirmation financière tant que l'événement réel n'est pas arrivé — les montants SEPA en traitement doivent être présentés séparément des montants confirmés, jamais agrégés ensemble comme s'ils étaient équivalents.

Une tentative échouée ne modifie jamais directement l'état de la créance — c'est le retry (§3) ou le repassage en flux de lien manuel qui en découle, toujours via une commande explicite, jamais par effet de bord automatique.

### 2.3 Autorisation de paiement (`payment_authorization`)

```
NON_PROPOSÉE
  │
  ▼ (popup post-paiement, PRD §4.4)
PROPOSÉE
  │
  ├──[client configure — SEPA : saisie IBAN + mandat ; carte : SetupIntent Stripe]──► EN_CONFIGURATION
  │        └──succès──► ACTIVE (is_default = true si aucune autre autorisation par défaut n'existe déjà)
  │        └──abandon──► REFUSÉE
  │
  ├──[refus direct]───────────────────────────────────────────────────────────────► REFUSÉE
  │
ACTIVE
  ├──[client ou prestataire révoque]──► RÉVOQUÉE
  ├──[carte expirée / mandat invalidé]──► EXPIRÉE
  └──[signal de risque ou litige ouvert]──► SUSPENDUE ──[résolution]──► ACTIVE ou RÉVOQUÉE
```

Seul un `payment_authorization` à l'état `ACTIVE` et `is_default = true` autorise la création d'une `tentative_paiement` de source `prelevement_auto` au MVP. Ce contrôle est une vérification systématique côté service métier, jamais une supposition. Le modèle permet à plusieurs autorisations de coexister à l'état `ACTIVE` (cf. §1) pour ne pas fermer la porte à un moyen de secours plus tard, mais un seul est utilisé et exposé au MVP.

### 2.4 Dossier de suivi (`dossier_suivi`) — le fil relationnel avec le client, indépendant de l'état financier

```
PRÉVENTION           (avant échéance, notices informatives)
  │
  ▼
ÉCHÉANCE              (jour J, lien envoyé)
  │
  ▼
SUIVI_AMIABLE         (relances graduées, registre libre de l'agent)
  │
  ├──[client ouvre "signaler un problème"]──► PAUSE_LITIGE
  ├──[silence, agent en attente de réponse]──► ATTENTE_CLIENT
  ├──[question posée au prestataire]──────────► ATTENTE_PRESTATAIRE
  └──[plafond de fermeté atteint ou signal fort]──► ESCALADE_HUMAINE
           │
           └──[prestataire tranche]──► CLOS
```

`CLOS` est terminal pour le dossier — mais n'implique rien en soi sur l'état de la créance sous-jacente (une créance peut être `RÉGLÉE` alors que son dossier de suivi est encore en cours de clôture administrative, ou `IRRÉCOUVRABLE` avec un dossier `CLOS` sans jamais être passée par un règlement).

---

## 3. Idempotence et retries

- Toute création de `tentative_paiement` doit être idempotente vis-à-vis de l'identifiant Stripe (`stripe_payment_intent_id` unique en base) — un webhook Stripe reçu deux fois ne doit jamais créer deux lignes de tentative, contrôle assuré concrètement par la table `processed_webhook_event` (cf. §1). La création d'une ligne `paiement` à partir d'une tentative réussie suit la même règle vis-à-vis de `tentative_paiement_id` (unique en base pour les paiements liés à une tentative).
- **Stratégie de retry — configurable, jamais figée en dur.** Une politique de retry ne doit pas être codée comme une règle universelle du type « 3 tentatives sur 5 jours » — ce chiffre n'était qu'une hypothèse de travail et ne doit pas devenir une logique structurante avant d'avoir été confrontée à des résultats réels. **Pour le MVP, le comportement par défaut est `retry_policy = none`** (une tentative échouée repasse immédiatement en flux de lien manuel + notification prestataire) ; une politique plus élaborée peut être ajoutée ensuite, et devra de toute façon dépendre d'au moins quatre facteurs distincts : le rail (carte vs SEPA), le code d'échec renvoyé par Stripe, le besoin d'authentification, et la présence ou non d'un litige ouvert sur la créance — un échec « provision insuffisante » n'appelle pas la même réponse qu'un échec « carte expirée » ou qu'un échec survenant pendant une période de litige.
- Chaque tentative échouée reste une ligne `tentative_paiement` en état `ÉCHOUÉE`, jamais supprimée ou écrasée — l'historique complet reste consultable, séparément de la table `paiement` qui ne contient que des règlements confirmés.
- Les webhooks Stripe (tentative réussie, tentative échouée, autorisation créée/révoquée) doivent être traités par une queue avec déduplication par `event_id` Stripe, pas par traitement direct synchrone dans le handler HTTP — pour tolérer les retries de Stripe lui-même sans double traitement.

---

## 4. Registre encadré — implémentation des garde-fous (traduction technique du PRD §3)

Les garde-fous non négociables du PRD doivent être des **contraintes système**, jamais de simples instructions données au LLM à respecter par bonne volonté :

- Toute action classée « action formelle » ne peut aboutir qu'à faire transitionner le dossier de suivi (§2.4) vers `ESCALADE_HUMAINE` — il n'existe techniquement aucun chemin de code qui permette à l'agent de déclencher directement une action de type contentieux sans passage par cet état intermédiaire bloquant, ni de modifier l'état de la créance elle-même à cette occasion.
- Tout montant d'étalement ou délai proposé au-delà des seuils définis en table `regle` déclenche la même mise en attente — vérification systématique côté serveur, jamais uniquement côté prompt de l'agent.
- Détection de litige : classification par LLM **et** filet de mots-clés/règles complémentaires en parallèle — recommandation de conception : traiter comme litige dès que l'un des deux signale, jamais nécessiter l'accord des deux (biais volontaire vers le faux positif plutôt que le faux négatif).

Table `regle` : liste de départ des paramètres configurables — délai de grâce, montant maximum d'étalement automatique, nombre de demandes tolérées avant escalade, seuil de montant nécessitant validation humaine, vitesse d'escalade du ton, plafond de fermeté, canaux autorisés, fréquence maximale de sollicitation, horaires autorisés. **[HYPOTHÈSE — liste à valider et probablement étendre en développement]**.

---

## 5. Intégrations externes — périmètre MVP

### Stripe Connect (direct charge)
Le prestataire est merchant of record. Commission captée via `application_fee_amount`, calculée à partir d'un paramètre commercial configurable `platform_fee_basis_points` — **fixé à 0 pendant l'Early Access** (cf. 02 §6), jamais une valeur positive codée en dur par plan. L'architecture conserve la capacité future de configurer une commission, mais aucune logique produit n'en dépend au MVP. Sur chaque paiement réussi de source `lien_agent` ou `prelevement_auto`, quel que soit le rail utilisé (carte ou SEPA Core) — jamais de commission générée sur un paiement de source `detecte_hors_sidian` (mécanisme hors MVP, cf. §12), principe conservé pour toute commission future si elle est un jour réintroduite. Le lien de paiement présente les deux rails via le Payment Element de Stripe (capable d'ordonner dynamiquement les moyens proposés), sans qu'aucun rail ne soit désactivé par une règle Sidian fondée sur un seuil de montant (cf. PRD §4.3). Webhooks à écouter au minimum : tentative réussie, tentative échouée, authentification requise, autorisation créée/révoquée, dispute ouverte. **[VALIDATION RESTANTE]** Limites Stripe à confirmer et surveiller : plafond SEPA Direct Debit par transaction et limite hebdomadaire initiale pour les nouveaux comptes, susceptibles d'évoluer.

**Disponibilité technique du lien vs envoi actif :** le lien ou la session de paiement est préparé à la création du paiement à recevoir, ou généré à la demande selon la stratégie Stripe retenue — sa disponibilité technique est distincte de son envoi actif par l'agent (cf. §7). Concrètement, le lien peut être visible pour le prestataire avant l'échéance, envoyé au client selon les règles de communication, et réutilisé ou régénéré selon sa durée de validité et le mécanisme Stripe choisi. **[VALIDATION RESTANTE]** Le choix exact entre un lien Stripe persistant, une session régénérée à chaque usage, ou une URL Sidian stable redirigeant vers une session fraîche à chaque clic, reste une question technique ouverte (cf. §9).

### Outil de facturation tiers (Pennylane ou autre)
Hors MVP (cf. PRD §8). Si développée un jour : lecture seule des factures émises pour pré-remplir `reference_externe` et faciliter la création de `creance` — jamais d'écriture dans l'outil tiers.

---

## 6. Sécurité

- RLS (Row Level Security) Supabase activée sur toutes les tables contenant des données de `prestataire` — un prestataire ne doit jamais pouvoir lire les créances, clients ou règles d'un autre, y compris via une requête mal formée côté client.
- Les identifiants de moyens de paiement et de mandats SEPA stockés par Sidian (`stripe_payment_method_id`, `stripe_mandate_id`) sont uniquement des références vers les objets du prestataire de paiement. Aucune donnée de carte ou donnée bancaire brute n'est stockée — conformité PCI déléguée à Stripe par construction. Le mot « mandat » ne désigne ici que le rail `sepa_core_mandate` ; pour la carte, on parle de moyen de paiement enregistré (`card_off_session`).
- Toute action du registre encadré (§4) crée une ligne `audit_log` (§1) avec l'identité de l'acteur (agent vs prestataire) et la règle appliquée, pour permettre un audit a posteriori en cas de litige avec un client.
- *(Si l'agrégation bancaire est développée un jour, cf. §13 : aucune donnée bancaire brute ne transitera ni ne sera stockée par Sidian, uniquement des tokens révocables fournis par le prestataire d'agrégation — contrainte à respecter dès la conception de cette brique, pas seulement au moment de la construire.)*

---

## 7. Workers et tâches planifiées (cron)

**Clarification préalable, verrouillée :** le lien de paiement est généré et accessible dès la création de la créance (cf. §1, §5), pas seulement à l'échéance. Ce que les workers ci-dessous déclenchent, c'est l'envoi *actif* du lien par l'agent selon le calendrier des règles — rien n'empêche un client volontaire de payer avant même de recevoir la moindre notice, en utilisant un lien que le prestataire lui aurait partagé plus tôt.

- **Scanner de prévention** (quotidien) : recherche les créances `OUVERTE` ou `PARTIELLEMENT_RÉGLÉE` dont l'échéance entre dans la fenêtre préventive (J-5) ; fait évoluer le `dossier_suivi` associé vers `PRÉVENTION` s'il n'y est pas déjà ; déclenche la notice uniquement si elle n'a pas déjà été envoyée.
- **Scanner d'échéance** (quotidien) : recherche les créances `OUVERTE` ou `PARTIELLEMENT_RÉGLÉE` dont l'échéance est atteinte ; fait évoluer le `dossier_suivi` vers `ÉCHÉANCE` ; déclenche l'envoi actif du lien si les règles l'autorisent — **ne change jamais directement l'état financier de la créance**.
- **Scanner de paiements automatiques** (quotidien) : recherche les créances `OUVERTE` ou `PARTIELLEMENT_RÉGLÉE` arrivées à échéance, non contestées (pas de `dossier_suivi` en `PAUSE_LITIGE`), et liées à une `payment_authorization` à l'état `ACTIVE` et `is_default = true` ; crée une `tentative_paiement` de source `prelevement_auto` — **ne modifie pas directement l'état de la créance**, seule la confirmation ultérieure de la tentative (§2.2) peut le faire.
- **Gestionnaire de tentative échouée** (déclenché par webhook, pas par cron) : analyse le rail et le motif d'échec ; décide, selon la politique de retry en vigueur (§3, `none` par défaut au MVP), s'il faut attendre une action du client, programmer une nouvelle tentative, ou repasser le `dossier_suivi` en flux manuel avec notification au prestataire.
- **Scanner de silence prolongé** (quotidien) : fait évoluer le `dossier_suivi` vers `ESCALADE_HUMAINE` selon le plafond configuré en `regle`, et notifie le prestataire — **ne crée jamais un état financier spécifique**, ne marque jamais automatiquement la créance comme `IRRÉCOUVRABLE` (cette transition reste une décision explicite du prestataire, cf. §2.1).
- **Scanner de clôture** (quotidien) : ferme le `dossier_suivi` (transition vers `CLOS`) lorsque la créance associée devient `RÉGLÉE`, `ANNULÉE` ou `IRRÉCOUVRABLE`, après exécution des communications administratives nécessaires (ex. confirmation de règlement au client).

---

## 8. Observabilité

Métriques techniques minimales à instrumenter dès le MVP, en miroir des KPI produit du PRD §7 :
- Taux de succès des webhooks Stripe traités sans erreur.
- Latence entre événement Stripe et transition d'état correspondante en base.
- Volume de messages générés par l'agent par jour, par type (registre libre vs encadré), pour surveiller les coûts et détecter une dérive de comportement.
- Alerte immédiate sur toute tentative de transition d'état qui contournerait un garde-fou du §4 (ne devrait jamais se produire — sa seule occurrence est un signal d'anomalie critique).
- *(Le taux de rapprochement bancaire automatique n'a pas lieu d'être au MVP puisque l'agrégation bancaire n'est pas construite — cf. §13. Cette métrique rejoindra la liste le jour où cette brique sera développée.)*

---

## 9. Questions techniques ouvertes

**[VALIDATION RESTANTE — à trancher avant développement de la brique concernée, pas avant le MVP dans son ensemble]**
1. Statut PDP / interopérabilité facturation électronique — sans impact sur le MVP tel que scopé en PRD §8.
2. Mécanisme précis de détection de litige (poids relatif classification LLM vs règles mots-clés).
3. Calibrage réel de la politique de retry (§3) une fois des données Stripe observées — le défaut `none` du MVP n'est qu'un point de départ prudent.
4. Stratégie exacte de génération du lien/session de paiement Stripe (§5) : lien persistant, session régénérée à chaque usage, ou URL Sidian stable redirigeant vers une session fraîche.

*(Les questions relatives à l'agrégation bancaire — choix du prestataire, rétention des événements non rapprochés — sont déplacées en §12, puisque cette brique entière est hors MVP.)*

---

## 10. Système IA — abstraction légère (traduction technique de 01, P9/P10)

**Principe :** le reste de Sidian n'appelle jamais un modèle par son nom. Une seule fonction centrale sert de point de passage.

```ts
type ModelProfile =
  | "classification"
  | "conversation"
  | "reasoning";

interface AIRequest {
  profile: ModelProfile;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  outputSchema?: unknown;
}

interface AIResponse<T = unknown> {
  content?: string;
  structuredOutput?: T;
  provider: string;
  model: string;
}

async function runAI<T>(request: AIRequest): Promise<AIResponse<T>> {
  // Sélection du fournisseur selon le profil. OpenAI comme fournisseur
  // unique au MVP. Un fallback multi-fournisseurs n'est pas construit
  // maintenant — voir §11.
  //
  // Le nom du profil décrit le besoin métier (classification légère,
  // conversation courante, raisonnement complexe), jamais une
  // considération de coût — le mapping profil → modèle/fournisseur
  // peut changer librement sans toucher au reste du code.
}
```

**Le modèle ne renvoie jamais une action, seulement une intention structurée**, systématiquement validée par une fonction métier avant toute exécution :

```ts
// Sortie du modèle — jamais exécutée telle quelle
{
  "intent": "draft_reminder",
  "creance_id": "creance_123",
  "tone": "courteous",
  "reason": "echeance_atteinte"
}

// Passage obligatoire par une fonction métier testée, avant toute action
const result = await validateReminderAction({
  actor,
  creance,
  clientRules,
  requestedIntent,
});
```

Cette fonction vérifie au minimum : que la créance appartient bien au prestataire concerné, qu'elle n'est pas déjà réglée, qu'aucun litige n'est ouvert dessus, que le canal demandé est autorisé, que la fréquence maximale configurée n'est pas dépassée. **Aucun "Policy Engine" séparé n'est construit au MVP** — une fonction métier correctement testée suffit, tant que le garde-fou reste impossible à contourner dans le code, indépendamment de sa forme d'implémentation.

**Toute action de type registre encadré (cf. §4) passe par le même schéma** : la fonction ne s'exécute jamais directement, elle crée une demande d'approbation.

```ts
async function requestFormalAction(input: FormalActionInput) {
  // L'agent ne peut jamais exécuter directement une action formelle.
  return createApprovalRequest({
    type: "formal_action",
    requestedBy: input.actor,
    creanceId: input.creanceId,
  });
}
```

**Traçabilité de l'origine, sans infrastructure dédiée :** un champ `actor_type` (`human` / `sidian_agent` / `system` / `external_integration`), et le cas échéant `actor_provider` / `actor_model`, suffit sur les tables `conversation`/`message` et sur toute création de `approval_request` (entité définie en §1) ou de `audit_log` (idem). C'est ce champ, pas une architecture séparée, qui permettra demain d'identifier qu'une action vient de Claude ou de ChatGPT plutôt que de l'agent natif — sans rien construire de plus aujourd'hui.

**Organisation de code recommandée pour le MVP :**

```
src/
├── ai/
│   ├── run-ai.ts
│   ├── model-profiles.ts
│   ├── prompts/
│   └── schemas/
├── domain/
│   ├── creances/
│   ├── paiements/
│   ├── communications/
│   └── regles/
├── services/
│   ├── stripe/
│   ├── email/
│   └── supabase/
└── audit/
```

## 11. Assistants externes (Claude, ChatGPT) et MCP — backlog, non construit au MVP

**Ce qui est vrai dès aujourd'hui, sans rien construire de plus :**
- La logique métier ne dépend d'aucun fournisseur IA (P9).
- Aucun modèle n'accède directement à Stripe ou Supabase — tout passe par les fonctions métier du §10.
- Les actions passent par les mêmes fonctions, qu'elles soient déclenchées par l'agent natif ou, un jour, par un assistant externe.
- Une future intégration MCP ne serait qu'un adaptateur fin vers ces fonctions existantes — jamais un lieu de logique métier propre.

**Explicitement repoussé, à ne construire qu'après un besoin utilisateur réel confirmé :** serveur MCP, Command Bus / Query Bus séparé, moteur de permissions générique, bascule automatique multi-fournisseurs, fallback dynamique entre plusieurs fournisseurs, event sourcing, catalogue public d'outils, scopes OAuth granulaires, découpage en microservices, système d'évaluation industriel.

**Test de validation à garder en tête pour le jour où ce sujet redevient pertinent :** Claude, ChatGPT et l'agent Sidian natif doivent, pour une même intention, appeler la même fonction métier, subir les mêmes contrôles, et produire le même résultat et la même trace d'audit. Le jour où ce test peut s'écrire, l'intégration externe est prête — pas avant.

---

## 12. Architecture différée — MVP+1

Cette section rassemble tout ce qui touche à l'agrégation bancaire et à la détection de paiement hors Sidian — délibérément absent des sections précédentes pour que le schéma MVP (§1) reflète exactement ce qui est construit maintenant, pas une anticipation. Rien ici n'est développé au MVP.

**Ce qui sera nécessaire le jour où cette brique est construite :**
- `prestataire.compte_bancaire_agrege` (bool, lecture seule) sur l'entité `prestataire`.
- Une entité `evenement_bancaire` : `id`, `prestataire_id` (FK), `montant`, `date_valeur`, `libelle_brut`, `creance_id_rapprochee` (nullable), `statut_rapprochement` (`rapproché` / `non_rapproché` / `ambigu`).
- Un moteur de rapprochement : pour chaque `evenement_bancaire` importé, recherche de `creance` à l'état `OUVERTE` ou `PARTIELLEMENT_RÉGLÉE` du même `prestataire_id`, avec un filtre temporel séparé de l'état financier (`date_echeance <= date du virement + tolérance`) et correspondance sur montant exact et proximité de référence textuelle. En cas d'ambiguïté, statut `ambigu` et validation manuelle requise — jamais de rapprochement automatique sur un score de confiance incertain.
- Un worker d'import (fréquence à définir selon l'API du prestataire retenu).
- Une métrique de taux de rapprochement automatique vs ambigu, à ajouter à l'observabilité (§8) une fois construite.

**Questions à trancher avant de construire cette brique, pas avant :**
1. Choix du prestataire d'agrégation bancaire (candidats évoqués : Bridge, Powens) — critères : couverture des banques des bêta-testeurs, coût par connexion, statut DSP2.
2. Politique de rétention des `evenement_bancaire` non rapprochés (durée de conservation, RGPD).

**Contrainte de conception à respecter dès la conception de cette brique, indépendante du prestataire retenu :** accès strictement lecture seule, jamais de scope d'écriture demandé même si l'API du prestataire le permet techniquement (cf. §6).

**Ce qui existe malgré tout au MVP, sans agrégation bancaire :** aucun paiement hors Sidian n'est automatiquement détecté au MVP. Un prestataire peut signaler manuellement qu'un paiement à recevoir est réglé hors plateforme, si cette possibilité est retenue côté produit (transition manuelle de la créance vers `RÉGLÉE`, cf. §2.1, à l'initiative du prestataire) — mais aucune agrégation bancaire n'est développée pour la détecter automatiquement.

---

## 13. Inventaire du code existant — méthode de tri (inchangée, reconfirmée)

Une seule question par brique du code Cursor actuel : dépend-elle du modèle abandonné (mission → enrôlement obligatoire → débit programmé, autour de la Facture) ?
- **Dépend → à refaire :** toute logique d'enrôlement bloquant, tout schéma centré sur la Facture plutôt que la Créance.
- **Neutre → à conserver :** authentification, design system, composants UI génériques, infrastructure Vercel, configuration Stripe de base (les objets Stripe Connect restent valides, seule la séquence qui les déclenche change).
- **À évaluer :** toute intégration Pennylane existante — à conserver seulement si suffisamment découplée pour devenir une simple source de `reference_externe` optionnelle, jamais un prérequis fonctionnel.

---

*Document 03 sur 3 — V2. Voir 01 · Fondations (P9/P10) et 02 · PRD.*
