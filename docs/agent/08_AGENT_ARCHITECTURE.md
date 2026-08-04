# SIDIAN — 08 · AGENT_ARCHITECTURE

**Version : 1.5 — Clarifications de cohérence produit et autonomie**  
**Statut : Verrouillé**  
**Dépendances principales :** `04_AGENT_CONSTITUTION.md`, `05_AGENT_PROMPTS.md`, `06_AGENT_TOOLS.md`, `07_AGENT_MEMORY.md`  
**Périmètre initial :** EPICU V1  
**Rôle du document :** Définir l’architecture logique et technique de Sidian, la séparation des responsabilités, les flux de décision, l’intégration du LLM, l’exécution des outils, la mémoire, le moteur déterministe, la sécurité, la résilience, l’observabilité et les règles d’exploitation.

---

# Préambule

Ce document transforme les principes fonctionnels et de gouvernance de Sidian en une architecture implémentable.

Il décrit :

- les composants du système ;
- leurs responsabilités ;
- leurs frontières ;
- les flux entre utilisateur, agent, outils et systèmes métier ;
- la manière dont le contexte est construit ;
- la manière dont les permissions sont vérifiées ;
- la manière dont les effets de bord sont exécutés ;
- la manière dont la mémoire est utilisée ;
- la manière dont les workflows automatisés sont séparés du LLM ;
- les exigences de sécurité, de résilience, de traçabilité et d’exploitation.

Ce document ne redéfinit pas :

- l’identité et les principes supérieurs de Sidian ;
- les règles de comportement du modèle ;
- les contrats fonctionnels détaillés de chaque outil ;
- les politiques fonctionnelles de mémoire ;
- les critères de test exhaustifs ;
- les règles juridiques définitives de conservation ou de conformité.

Ces éléments relèvent respectivement des documents Constitution, Prompts, Tools, Memory, Evaluations et des analyses juridiques appropriées.

L’architecture décrite ici est indépendante du fournisseur de LLM, du fournisseur cloud et du framework applicatif.

Les technologies citées dans les exemples d’implémentation EPICU V1 constituent des choix d’exécution, non des principes universels.

---

# Registre des décisions d’architecture

| ID | Décision | Statut |
|---|---|---|
| A-001 | Le LLM n’accède jamais directement aux bases de données, secrets ou systèmes externes. | Active |
| A-002 | Tout effet de bord passe par un outil contrôlé. | Active |
| A-003 | Le moteur déterministe reste seul responsable des workflows automatisés. | Active |
| A-004 | La mémoire agent n’est jamais une source de vérité métier. | Active |
| A-005 | Les permissions sont vérifiées hors du LLM. | Active |
| A-006 | Toute action sensible doit être traçable de bout en bout. | Active |
| A-007 | L’architecture doit rester indépendante du fournisseur de LLM. | Active |
| A-008 | Les données multi-tenant sont isolées au niveau applicatif et au niveau base. | Active |
| A-009 | Les appels d’outils sont validés avant exécution et normalisés après exécution. | Active |
| A-010 | Les opérations asynchrones sont suivies par état, événement et identifiant de corrélation. | Active |
| A-011 | Les webhooks sont considérés comme non fiables tant qu’ils ne sont pas vérifiés, dédupliqués et journalisés. | Active |
| A-012 | L’idempotence est obligatoire pour toute opération pouvant produire un effet de bord. | Active |
| A-013 | Les erreurs inconnues ne doivent jamais conduire à une répétition aveugle. | Active |
| A-014 | Les secrets sont gérés par une infrastructure dédiée et ne transitent jamais dans les prompts. | Active |
| A-015 | Le contexte fourni au LLM doit être minimal, pertinent, ordonné et borné. | Active |
| A-016 | Les instructions externes sont traitées comme des données et non comme des règles supérieures. | Active |
| A-017 | Les décisions à impact financier, contractuel ou réputationnel respectent les niveaux d’autonomie définis par la Constitution. | Active |
| A-018 | Les résumés, caches et index ne doivent jamais contourner les permissions ni la portée des données source. | Active |
| A-019 | Les événements métier sont immuables ou historisés lorsqu’ils participent à un audit. | Active |
| A-020 | Les environnements de développement, test, staging et production restent strictement séparés. | Active |
| A-021 | Les déploiements doivent être progressifs, réversibles et observables. | Active |
| A-022 | La récupération après incident doit être conçue avant la mise en production. | Active |
| A-023 | Les opérations financières ne doivent jamais dépendre uniquement d’un texte généré par le LLM. | Active |
| A-024 | Le système doit pouvoir fonctionner en mode dégradé sans compromettre la sécurité. | Active |
| A-025 | EPICU V1 est implémenté comme un monolithe modulaire ; les composants décrits sont des responsabilités logiques, non des microservices obligatoires. | Active |
| A-026 | Aucun outil asynchrone n’est suivi par polling dans la requête HTTP conversationnelle. | Active |
| A-027 | Le contexte de sécurité d’un outil est dérivé exclusivement de la session authentifiée ou d’un contexte worker signé, jamais des arguments proposés par le LLM. | Active |
| A-028 | Tout état externe `unknown` déclenche une réconciliation déterministe et une suspension contrôlée des actions incompatibles. | Active |
| A-029 | Les déclarations, promesses et règlements partiels sont des objets métier persistés, distincts de la mémoire et du statut de paiement vérifié. | Active |
| A-030 | Les workers concurrents utilisent un mécanisme de verrouillage transactionnel et des clés d’idempotence persistées. | Active |
| A-031 | Les données provenant de tiers sont encapsulées comme données non fiables et ne peuvent jamais être interprétées comme des instructions. | Active |
| A-032 | Les usages et coûts du LLM sont plafonnés et suivis par organisation. | Active |
| A-033 | La génération asynchrone de contenu utilise un service batch sans historique conversationnel, distinct de l’orchestrateur de chat. | Active |
| A-034 | Le registre d’outils reprend intégralement les champs obligatoires définis par `06_AGENT_TOOLS`, notamment le niveau maximal d’autonomie et la validation humaine requise. | Active |
| A-035 | Pour EPICU V1, les notions de compte, organisation et tenant correspondent à une même frontière d’isolation portée par `organization_id` et propagée comme `tenant_id`. | Active |

---

# Chapitre 0 — Objectifs d’architecture

## 0.1 Objectifs principaux

L’architecture doit permettre à Sidian de :

- comprendre une demande utilisateur ;
- construire un contexte fiable ;
- distinguer faits, déclarations, inférences et inconnues ;
- vérifier les permissions ;
- proposer ou exécuter une action selon le niveau d’autonomie ;
- appeler des outils contrôlés ;
- suivre les résultats synchrones et asynchrones ;
- expliquer ce qui a été fait ;
- reprendre une conversation ;
- résister aux erreurs, injections et contradictions ;
- fonctionner dans un environnement multi-tenant ;
- évoluer sans dépendre d’un modèle unique.

## 0.2 Objectifs non fonctionnels

Le système doit viser :

- sécurité ;
- cohérence ;
- explicabilité ;
- résilience ;
- observabilité ;
- maintenabilité ;
- testabilité ;
- réversibilité ;
- maîtrise des coûts ;
- performance suffisante ;
- conformité ;
- isolation des clients.

## 0.3 Non-objectifs

EPICU V1 ne vise pas nécessairement :

- une architecture microservices complète ;
- une autonomie totale de l’agent ;
- une mémoire vectorielle générale ;
- une orchestration multi-agent ;
- une exécution distribuée multi-région ;
- une optimisation prématurée de très grande échelle ;
- une abstraction universelle de tous les systèmes financiers.

Le produit doit préserver les frontières d’architecture sans imposer une complexité prématurée.

---

# Chapitre 1 — Principes fondamentaux

## 1.1 Séparation raisonnement / exécution

Le LLM raisonne, classe, résume et propose.

Il ne doit pas :

- accéder directement aux données ;
- modifier directement un état métier ;
- lancer directement un prélèvement ;
- envoyer directement un message ;
- écrire directement dans la mémoire ;
- contourner les permissions ;
- exécuter un workflow planifié.

Les effets de bord sont délégués à des outils et services déterministes.

## 1.2 Séparation agent / moteur déterministe

Le moteur déterministe exécute :

- les échéances ;
- les délais ;
- les transitions ;
- les reprises ;
- les tentatives ;
- les webhooks ;
- les tâches planifiées ;
- les règles produit formelles.

L’agent conversationnel intervient pour :

- comprendre une demande ;
- expliquer un état ;
- recueillir une information ;
- préparer une action ;
- demander une validation ;
- interpréter une contradiction ;
- transmettre à un humain.

Le LLM ne doit jamais être la source de vérité d’un workflow J+2, J+5, J+9, J+10 ou de toute autre séquence automatisée.

## 1.3 Séparation données métier / mémoire

La base métier contient l’état actuel et historique des objets métier.

La mémoire contient :

- des résumés ;
- des préférences ;
- du contexte conversationnel ;
- des références ;
- des contradictions ;
- des éléments de continuité.

La mémoire ne peut pas remplacer :

- une facture ;
- un contrat ;
- un paiement ;
- une permission ;
- un litige ;
- une échéance ;
- un statut de workflow.

## 1.4 Principe de moindre privilège

Chaque composant ne reçoit que les accès nécessaires.

Exemples :

- le service de prompt ne connaît pas les secrets Stripe ;
- le LLM ne connaît pas les identifiants de connexion ;
- le service de notification n’accède pas à toutes les données comptables ;
- un worker de webhook n’a pas le droit de modifier des préférences utilisateur ;
- un utilisateur ne peut pas lire les données d’un autre tenant.

## 1.5 Principe de défense en profondeur

Aucune barrière unique ne doit suffire à protéger une action sensible.

Une action financière peut être protégée par :

- authentification ;
- contrôle du rôle ;
- validation d’autorisation ;
- validation de l’objet métier ;
- règle d’autonomie ;
- idempotence ;
- audit ;
- confirmation humaine éventuelle ;
- contrôle après exécution.

## 1.6 Principe de contexte minimal

Le LLM ne doit recevoir que le contexte utile.

Le système évite :

- les historiques complets inutiles ;
- les données sensibles non nécessaires ;
- les documents entiers lorsqu’un extrait suffit ;
- les doublons ;
- les anciennes versions ;
- les données d’autres objets ;
- les secrets ;
- les détails techniques internes.

## 1.7 Principe de vérité autoritative

Lorsqu’une donnée peut être vérifiée, le système doit privilégier la source la plus autoritative et la plus fraîche.

Ordre général :

1. règles supérieures ;
2. permissions actuelles ;
3. données métier actuelles ;
4. résultats d’outils fiables ;
5. validations humaines récentes ;
6. mémoire vérifiée ;
7. déclaration ;
8. inférence ;
9. inconnu.

## 1.8 Principe d’état explicite

Les objets sensibles doivent avoir un état explicite.

Exemples :

- `draft` ;
- `pending_approval` ;
- `scheduled` ;
- `processing` ;
- `succeeded` ;
- `failed` ;
- `cancelled` ;
- `unknown`.

Les états implicites fondés uniquement sur du texte doivent être évités.

---

# Chapitre 2 — Vue d’ensemble

## 2.1 Schéma logique

```text
Utilisateur / Interface
        |
        v
Conversation API
        |
        v
Request Gateway
        |
        v
Authentication & Tenant Context
        |
        v
Conversation Orchestrator
        |
        +----------------------+
        |                      |
        v                      v
Context Builder          Permission Service
        |                      |
        +----------+-----------+
                   |
                   v
              Prompt Builder
                   |
                   v
              LLM Gateway
                   |
          +--------+--------+
          |                 |
          v                 v
     Réponse texte      Tool Request
                            |
                            v
                       Tool Router
                            |
               +------------+------------+
               |            |            |
               v            v            v
          Domain API   Memory Service  External Adapters
               |            |            |
               +------------+------------+
                            |
                            v
                       Audit & Events
                            |
                            v
                     Response Composer
                            |
                            v
                        Utilisateur
```

En parallèle :

```text
Scheduler / Queue / Webhooks
          |
          v
Deterministic Workflow Engine
          |
          v
Domain Services
          |
          v
Database / External Providers / Notifications
```

## 2.2 Flux synchrones

Un flux synchrone concerne une interaction où le résultat peut être produit dans le délai de réponse.

Exemples :

- consulter une facture ;
- lire un statut ;
- créer un brouillon ;
- expliquer un litige ;
- modifier une préférence ;
- rechercher un client.

## 2.3 Flux asynchrones

Un flux asynchrone concerne :

- traitement long ;
- appel externe différé ;
- webhook ;
- prélèvement ;
- génération de rapport ;
- notification planifiée ;
- reprise ;
- tâche de fond.

Le système doit retourner :

- un identifiant ;
- un état initial ;
- un mécanisme de suivi ;
- une corrélation ;
- une politique de reprise.

## 2.4 Plans de contrôle et de données

### Plan de contrôle

Il contient :

- règles ;
- permissions ;
- configuration ;
- modèles de prompts ;
- flags ;
- politiques ;
- versions ;
- limites.

### Plan de données

Il contient :

- conversations ;
- objets métier ;
- événements ;
- résultats ;
- mémoires ;
- audits ;
- métriques.

Les deux plans doivent être séparés autant que possible.

---

# Chapitre 3 — Composants

## 3.0 Nature des composants dans EPICU V1

Les composants décrits dans ce chapitre représentent des **responsabilités logiques et des frontières de code**. Ils ne doivent pas être interprétés comme des services réseau indépendants.

EPICU V1 adopte officiellement un **monolithe modulaire**, organisé autour de trois ensembles déployables :

1. **Core App & Domain** : Interface utilisateur, Authentication Service, Tenant Context Service, Permission Service, Domain Services, Memory Service et accès PostgreSQL ;
2. **Agent Engine** : Conversation API, Conversation Orchestrator, Context Builder, Prompt Builder, LLM Gateway, Output Validator et Tool Router ;
3. **Background Job Engine** : Scheduler, Workflow Engine, Webhook Gateway, Event Bus/Queue, Batch Prompt Generation Service, Reconciliation Worker, notifications et autres workers.

Quatre composants sont **transverses** et partagés par ces ensembles : Request Gateway, Audit Service, Configuration Service et Secrets Manager. L’Observability Stack couvre également les trois ensembles.

Ces rattachements sont des frontières de code et de responsabilité, pas des obligations de déploiement séparé. Les ensembles peuvent partager un dépôt et, au lancement, une même application ou infrastructure d’exécution. Le découpage en services réseau distincts ne devient pertinent que lorsqu’un besoin démontré de scalabilité, d’isolation, de sécurité ou de cadence de déploiement le justifie.

## 3.1 Interface utilisateur

### Responsabilités

- collecte de la demande ;
- présentation des réponses ;
- affichage des confirmations ;
- visualisation des actions ;
- gestion des erreurs ;
- affichage des sources et statuts ;
- contrôle des préférences.

### Contraintes

L’interface ne doit pas :

- considérer une réponse du LLM comme une action réussie sans confirmation backend ;
- masquer une incertitude ;
- fusionner des tenants ;
- exposer des identifiants internes sensibles.

## 3.2 Conversation API

### Responsabilités

- recevoir les messages ;
- vérifier les limites ;
- attribuer un identifiant de requête ;
- associer l’utilisateur, le tenant et la conversation ;
- diffuser la réponse ;
- gérer le streaming éventuel.

### Entrée minimale

- `request_id` ;
- `tenant_id` ;
- `user_id` ;
- `conversation_id` ;
- `message` ;
- métadonnées autorisées.

### Sortie minimale

- texte ;
- état ;
- actions éventuelles ;
- références ;
- identifiant de trace ;
- indicateur d’incertitude éventuel.

## 3.3 Request Gateway

### Responsabilités

- rate limiting ;
- contrôle de taille ;
- validation de format ;
- protection anti-abus ;
- propagation des corrélations ;
- normalisation des erreurs.

## 3.4 Authentication Service

### Responsabilités

- validation de session ;
- identité utilisateur ;
- appartenance au tenant ;
- niveau d’authentification ;
- expiration ;
- révocation.

L’identité ne doit jamais être dérivée d’un texte utilisateur.

## 3.5 Tenant Context Service

### Responsabilités

- déterminer le tenant actif ;
- vérifier l’accès à l’organisation ;
- injecter les restrictions ;
- empêcher les accès croisés ;
- propager `tenant_id`.

Le `tenant_id` doit être obligatoire dans tous les accès multi-tenant.

## 3.6 Conversation Orchestrator

### Responsabilités

- piloter la requête ;
- construire le contexte ;
- appeler le LLM ;
- gérer les tool calls ;
- appliquer les boucles ;
- composer la réponse ;
- journaliser.

Il ne doit pas :

- contenir toute la logique métier ;
- exécuter directement des effets de bord ;
- définir les permissions ;
- devenir un moteur de workflow.

## 3.7 Context Builder

### Responsabilités

- sélectionner les données pertinentes ;
- appliquer la priorité des sources ;
- réduire le bruit ;
- limiter les tokens ;
- exclure les données interdites ;
- marquer provenance et fraîcheur ;
- construire un contexte structuré.

### Entrées possibles

- message courant ;
- historique résumé ;
- mémoire pertinente ;
- données métier ;
- permissions ;
- configuration ;
- résultat d’outils ;
- documents autorisés.

## 3.8 Prompt Builder

### Responsabilités

- assembler les couches de prompt ;
- respecter leur ordre ;
- inclure les règles ;
- injecter les outils disponibles ;
- encoder les contraintes de sortie ;
- ajouter la date et le contexte opérationnel ;
- versionner la construction.

Le Prompt Builder ne doit pas contenir de secrets.

## 3.9 LLM Gateway

### Responsabilités

- abstraction fournisseur ;
- sélection du modèle ;
- timeout ;
- retries autorisés ;
- streaming ;
- contrôle de coût ;
- validation de sortie ;
- fallback ;
- journalisation des métadonnées.

### Interdictions

- pas de données brutes excessives ;
- pas de secrets ;
- pas de rôle implicite ;
- pas d’accès direct à la DB ;
- pas de provider lock-in non contrôlé.

## 3.10 Model Router

**Hors périmètre EPICU V1.**

EPICU V1 utilise un modèle principal versionné et peut utiliser, au maximum, un modèle de fallback explicitement testé. Aucun routage dynamique, aucune classification produite par le LLM pour sélectionner un modèle et aucun modèle spécialisé ne sont actifs dans SIDIAN Specification v1.0.

Une version future pourra introduire une sélection contrôlée entre plusieurs modèles selon des critères versionnés de sensibilité, coût, latence, longueur, complexité, disponibilité et politique de données. Cette capacité future ne constitue pas une exigence implémentable en V1.

## 3.11 Output Validator

### Responsabilités

- vérifier le format ;
- détecter une sortie vide ;
- contrôler les tool calls ;
- valider les arguments ;
- rejeter les champs interdits ;
- limiter les actions ;
- détecter une contradiction structurelle.

Il ne garantit pas la vérité du contenu, mais garantit le respect du contrat.

## 3.12 Permission Service

### Responsabilités

- autoriser ou refuser ;
- vérifier rôle, tenant et objet ;
- appliquer les règles d’autonomie ;
- vérifier la portée ;
- produire une décision explicable ;
- journaliser.

### Sortie

```json
{
  "decision": "allow | deny | require_approval",
  "reason_code": "ROLE_MISSING",
  "policy_version": "perm_2026_07",
  "scope": {
    "tenant_id": "t_1",
    "resource_id": "inv_1"
  }
}
```

Le LLM ne peut pas modifier cette décision.

## 3.13 Tool Router

### Responsabilités

- résoudre l’outil ;
- vérifier sa version ;
- valider les arguments ;
- vérifier la permission ;
- injecter le contexte technique ;
- appliquer timeout, retry et idempotence ;
- normaliser le résultat ;
- journaliser.

## 3.14 Domain Services

Ils contiennent la logique métier déterministe.

Exemples :

- Client Service ;
- Contract Service ;
- Invoice Service ;
- Enrollment Service ;
- Payment Service ;
- Alert Service ;
- Dispute Service ;
- Notification Service ;
- Reporting Service.

Ils ne doivent pas dépendre d’une interprétation libre du LLM.

## 3.15 Workflow Engine

### Responsabilités

- transitions d’état ;
- planification ;
- reprise ;
- délais ;
- retries ;
- expiration ;
- tâches de fond ;
- compensation ;
- contrôle d’idempotence.

Il est décrit au Chapitre 8.

## 3.16 Memory Service

### Responsabilités

- rechercher le contexte ;
- créer et mettre à jour des mémoires ;
- appliquer portée et expiration ;
- gérer les conflits ;
- invalider ;
- supprimer ;
- propager les suppressions ;
- auditer.

La politique fonctionnelle relève du document Memory.

## 3.17 Batch Prompt Generation Service

### Responsabilités

- générer un contenu asynchrone à partir d’un template et de données métier vérifiées ;
- appeler directement la LLM Gateway sans passer par l’Orchestrateur de conversation ;
- ne pas charger l’historique de chat de l’utilisateur ;
- produire une sortie validée, versionnée et auditable ;
- revenir à un template déterministe si la génération échoue.

Il peut être utilisé, par exemple, pour préparer une formulation personnalisée de notification. Le Workflow Engine conserve cependant la maîtrise de la date, du destinataire, de l’état et de l’envoi.

## 3.18 Reconciliation Worker

### Responsabilités

- rechercher les opérations en état `unknown`, `pending_reconciliation` ou incohérent ;
- interroger la source autoritative externe ;
- rétablir un statut vérifié ;
- reprendre ou maintenir en pause le workflow concerné ;
- escalader vers un humain lorsque le délai maximal est dépassé ;
- journaliser chaque tentative.

Le Reconciliation Worker n’invente jamais un résultat. Il compare l’état local avec les identifiants d’idempotence, événements et objets du fournisseur.

## 3.19 Event Bus / Queue

### Responsabilités

- découpler ;
- absorber les pics ;
- distribuer ;
- rejouer ;
- suivre les échecs ;
- conserver un ordre lorsque nécessaire.

Exemples d’événements :

- `invoice.created` ;
- `invoice.due_soon` ;
- `payment.declared` ;
- `payment.succeeded` ;
- `payment.failed` ;
- `reminder.scheduled` ;
- `reminder.sent` ;
- `dispute.opened`.

## 3.20 Scheduler

### Responsabilités

- déclencher les échéances ;
- produire des événements ;
- garantir la reprise ;
- éviter les doublons ;
- tenir compte des fuseaux horaires ;
- gérer les jours ouvrés si nécessaire.

## 3.21 Webhook Gateway

### Responsabilités

- vérifier signature ;
- enregistrer l’événement brut ;
- dédupliquer ;
- répondre rapidement ;
- pousser en file ;
- traiter hors requête ;
- tracer les erreurs.

## 3.22 Audit Service

### Responsabilités

- journaliser les actions ;
- conserver l’acteur ;
- conserver l’objet ;
- conserver avant/après lorsque nécessaire ;
- conserver la décision de permission ;
- conserver la corrélation ;
- rendre l’audit consultable.

## 3.23 Observability Stack

Elle regroupe :

- logs ;
- métriques ;
- traces ;
- alertes ;
- dashboards ;
- coûts ;
- qualité ;
- SLO.

## 3.24 Configuration Service

### Responsabilités

- règles versionnées ;
- seuils ;
- templates ;
- feature flags ;
- fournisseurs ;
- politiques ;
- paramètres par environnement.

La configuration critique ne doit pas être modifiée sans audit.

## 3.25 Secrets Manager

### Responsabilités

- stockage ;
- rotation ;
- accès limité ;
- audit ;
- séparation des environnements ;
- révocation.

---

# Chapitre 4 — Pipeline complet d’une interaction

## 4.1 Étape 1 — Réception

Le message reçoit :

- `request_id` ;
- `conversation_id` ;
- `tenant_id` ;
- `user_id` ;
- horodatage ;
- canal ;
- version client.

## 4.2 Étape 2 — Prévalidation

Contrôles :

- authentification ;
- taille ;
- tenant ;
- statut du compte ;
- quota ;
- abus ;
- format.

## 4.3 Étape 3 — Classification initiale

Une classification légère peut identifier :

- question ;
- consultation ;
- demande d’action ;
- correction ;
- suppression ;
- incident ;
- ambiguïté ;
- contenu suspect.

Cette étape ne remplace pas le raisonnement du modèle.

## 4.4 Étape 4 — Construction du contexte

Le Context Builder collecte :

1. règles constitutionnelles ;
2. prompt applicable ;
3. permission et rôle ;
4. données métier ;
5. mémoire ;
6. historique résumé ;
7. message courant ;
8. outils disponibles.

## 4.5 Étape 5 — Appel LLM

Le LLM produit :

- une réponse ;
- une demande d’outil ;
- une clarification ;
- un refus ;
- une transmission ;
- une proposition.

## 4.6 Étape 6 — Validation de sortie

Le système vérifie :

- schéma ;
- outil autorisé ;
- nombre d’appels ;
- arguments ;
- champs ;
- contenu interdit ;
- cohérence minimale.

## 4.7 Étape 7 — Vérification de permission

Avant chaque outil sensible :

- acteur ;
- tenant ;
- rôle ;
- objet ;
- action ;
- état ;
- autonomie ;
- validation requise.

## 4.8 Étape 8 — Exécution d’outil

Le Tool Router :

- crée une idempotency key ;
- appelle le service ;
- applique timeout ;
- capture résultat ;
- normalise ;
- trace.

## 4.9 Étape 9 — Boucle de raisonnement contrôlée

La boucle synchrone est strictement bornée aux opérations pouvant terminer dans le budget de la requête HTTP.

Elle peut contenir :

- une génération LLM ;
- un petit nombre d’outils synchrones à faible latence ;
- une reformulation finale.

Elle ne peut pas contenir :

- de polling ;
- d’attente active ;
- de tâche planifiée ;
- de traitement long ;
- de boucle jusqu’à succès ;
- de dépendance à un webhook.

Lorsqu’un outil retourne `pending`, l’Orchestrateur :

1. enregistre l’`operation_id` ;
2. répond immédiatement à l’utilisateur ;
3. délègue le suivi au Background Job Engine ;
4. restitue le résultat lors d’une notification, d’un rafraîchissement ou d’une interaction ultérieure.

Limites obligatoires :

- nombre maximal d’itérations ;
- coût maximal ;
- durée maximale ;
- nombre maximal d’outils ;
- interdiction de boucle autonome illimitée.

## 4.10 Étape 10 — Composition de réponse

La réponse finale distingue :

- ce qui est vérifié ;
- ce qui a été déclaré ;
- ce qui a été exécuté ;
- ce qui reste en attente ;
- ce qui nécessite validation ;
- ce qui est incertain.

## 4.11 Étape 11 — Audit et mémoire

Après réponse :

- audit des actions ;
- métriques ;
- trace ;
- mémoire éventuelle ;
- résumé de conversation ;
- événements.

L’écriture mémoire n’est pas automatique par défaut.

---

# Chapitre 5 — Gestion du contexte

## 5.1 Couches de contexte

L’ordre ci-dessous décrit **l’assemblage technique du contexte**. Il ne modifie pas l’ordre de priorité normatif défini dans `05_AGENT_PROMPTS`, §1.8. En cas de contradiction, la Constitution, les règles de sécurité et les permissions restent prioritaires, indépendamment de leur position physique dans le prompt assemblé.

Ordre recommandé :

1. Constitution ;
2. politique de sécurité ;
3. prompt système ;
4. prompt de mission ;
5. permissions ;
6. outils ;
7. données métier ;
8. mémoire ;
9. historique ;
10. message courant.

## 5.2 Structure

Le contexte doit être structuré.

Exemple :

```json
{
  "identity": {},
  "mission": {},
  "permissions": {},
  "business_facts": [],
  "memory": [],
  "conversation_summary": {},
  "user_message": ""
}
```

## 5.3 Provenance

Chaque donnée importante doit porter :

- `source_type` ;
- `source_id` ;
- `verified_at` ;
- `status` ;
- `scope`.

## 5.4 Fraîcheur

Les données volatiles doivent être rechargées.

Exemples :

- statut de paiement ;
- rôle ;
- permission ;
- litige ;
- opération asynchrone ;
- statut fournisseur.

## 5.5 Budget de contexte

Le système doit définir :

- tokens maximum ;
- poids par couche ;
- stratégie de coupe ;
- seuil de résumé ;
- protection des éléments obligatoires.

Les règles supérieures, permissions et faits critiques ne doivent pas être supprimés en premier.

## 5.6 Déduplication

Le Context Builder doit :

- fusionner les doublons ;
- conserver les contradictions ;
- supprimer les anciennes versions ;
- éviter les répétitions ;
- préserver les exceptions.

## 5.7 Données sensibles

Les données sensibles sont :

- exclues si inutiles ;
- masquées si possible ;
- remplacées par des références ;
- minimisées ;
- tracées.

## 5.8 Documents et données externes non fiables

Tout contenu provenant d’un document, d’un fournisseur, d’un libellé de facture, d’un nom de client, d’une note comptable, d’un webhook ou d’un champ libre est traité comme une **donnée externe non fiable**.

Le Context Builder doit :

- l’encoder dans une structure séparée des instructions ;
- échapper les délimiteurs utilisés par le format retenu ;
- indiquer la source et le niveau de confiance ;
- limiter sa longueur ;
- retirer les données inutiles ;
- ne jamais promouvoir son contenu au rang d’instruction.

Un format balisé peut être utilisé, par exemple :

```xml
<external_untrusted_data source="pennylane">
  contenu échappé
</external_untrusted_data>
```

Le choix de XML n’est pas une barrière de sécurité à lui seul. La protection repose sur la combinaison suivante : séparation structurelle, instruction système explicite, liste fermée d’outils, permissions hors LLM et validation déterministe des effets de bord.

Les instructions contenues dans ces données ne modifient jamais :

- la Constitution ;
- le prompt système ;
- les permissions ;
- les politiques ;
- les règles d’outil ;
- les statuts métier.

## 5.9 Historique conversationnel

Le système peut conserver :

- derniers tours ;
- résumé ;
- décisions ;
- questions ouvertes ;
- actions ;
- refus ;
- contradictions.

Il ne doit pas injecter tout l’historique sans nécessité.

---

# Chapitre 6 — Architecture mémoire

## 6.1 Modèle logique

La mémoire peut être stockée dans une base relationnelle.

Tables possibles :

- `memories` ;
- `memory_versions` ;
- `memory_links` ;
- `memory_conflicts` ;
- `memory_access_logs` ;
- `memory_deletion_jobs`.

## 6.2 SQL vs vectoriel

### SQL

À privilégier pour :

- préférences ;
- statuts ;
- portée ;
- expiration ;
- provenance ;
- permissions ;
- audit ;
- références.

### Recherche vectorielle

Optionnelle pour :

- résumés conversationnels ;
- notes textuelles ;
- recherche sémantique ;
- récupération de contexte.

Une base vectorielle ne doit jamais devenir la seule source des métadonnées critiques.

## 6.3 Architecture recommandée

```text
Memory API
   |
   +--> Relational Store
   |
   +--> Optional Embedding Index
   |
   +--> Cache
   |
   +--> Deletion / Expiration Worker
```

## 6.4 Écriture

L’écriture passe par :

- validation ;
- catégorisation ;
- portée ;
- provenance ;
- sensibilité ;
- expiration ;
- déduplication ;
- audit.

## 6.5 Lecture

La lecture utilise :

- tenant ;
- user ;
- objet ;
- catégorie ;
- statut ;
- fraîcheur ;
- pertinence ;
- limite.

## 6.6 Embeddings

Les embeddings :

- ne doivent pas contenir de secrets ;
- doivent respecter le tenant ;
- doivent être supprimables ;
- doivent avoir une version de modèle ;
- doivent être recalculables ;
- ne doivent pas être utilisés pour contourner les filtres SQL.

## 6.7 Cache mémoire

Le cache peut accélérer :

- préférences ;
- résumés ;
- contexte récent.

Il doit :

- respecter le tenant ;
- expirer ;
- être invalidé ;
- ne pas survivre à une suppression ;
- ne pas devenir source de vérité.

## 6.8 Suppression

La suppression doit couvrir :

- table principale ;
- versions ;
- index vectoriel ;
- cache ;
- résumés dérivés ;
- export temporaire.

## 6.9 Gouvernance MVP

EPICU V1 peut commencer avec :

- SQL uniquement ;
- résumé conversationnel court ;
- préférences simples ;
- notes métier référencées ;
- pas de mémoire vectorielle générale.

---

# Chapitre 7 — Architecture des outils

## 7.1 Cycle

```text
LLM Request
   |
   v
Schema Validation
   |
   v
Permission Check
   |
   v
Idempotency Check
   |
   v
Execution
   |
   v
Result Normalization
   |
   v
Audit
```

## 7.2 Tool Registry

Chaque outil déclare au minimum l’intégralité des champs obligatoires définis dans `06_AGENT_TOOLS`, §12.1. La représentation technique du registre comprend notamment :

- identifiant unique ;
- nom et version ;
- catégorie et propriétaire ;
- type d’opération : lecture ou écriture ;
- description ;
- schéma d’entrée ;
- schéma de sortie ;
- erreurs normalisées ;
- permissions requises ;
- niveau maximal d’autonomie ;
- validation humaine requise ;
- niveau de risque ;
- effets secondaires ;
- données sensibles manipulées ;
- politique de logs et d’audit ;
- timeout ;
- politique de retry ;
- idempotence ;
- mode synchrone ou asynchrone ;
- statut du registre.

Exemple de champs de contrôle :

```json
{
  "autonomy": {
    "maximum_level": 3,
    "allowed_modes": ["agir", "conseiller", "transmettre"]
  },
  "human_validation_required": true,
  "permissions": ["invoice.payment_attempt.create"],
  "risk_level": "high"
}
```

Le Tool Router doit refuser l’exécution lorsqu’un appel dépasse `autonomy.maximum_level` ou lorsqu’une validation humaine obligatoire n’est pas matérialisée par une approbation valide.

## 7.3 Validation

Les arguments sont validés par code.

Le système rejette :

- champs inconnus ;
- types invalides ;
- identifiants hors tenant ;
- paramètres interdits ;
- montants incohérents ;
- dates impossibles ;
- outils obsolètes.

## 7.4 Idempotence

Toute action sensible reçoit une clé.

Exemples :

- envoi ;
- prélèvement ;
- création de contrat ;
- génération d’un avoir ;
- suspension ;
- webhook.

## 7.5 Retries

Autoriser un retry seulement si :

- erreur transitoire ;
- opération idempotente ;
- résultat non ambigu ;
- politique définie.

Pas de retry automatique aveugle pour :

- paiement ;
- action financière ;
- suppression ;
- création externe ;
- résultat inconnu.

## 7.6 Circuit breaker

Un fournisseur instable peut être isolé.

États :

- fermé ;
- ouvert ;
- semi-ouvert.

Le système doit afficher un mode dégradé clair.

## 7.7 Outils asynchrones

Retour minimal :

```json
{
  "status": "pending",
  "operation_id": "op_123",
  "next_status_check_after_seconds": 10
}
```

Le champ `next_status_check_after_seconds` est une indication destinée à un worker de fond ou à une consultation ultérieure explicite ; il n’autorise jamais le Conversation Orchestrator à effectuer du polling dans la requête HTTP.

Le résultat final arrive via :

- webhook ;
- événement ;
- notification ;
- lecture ultérieure explicite de l’état.

Le polling interne éventuel appartient exclusivement à un worker de fond. Il est interdit dans la requête HTTP conversationnelle.

## 7.8 Normalisation

Les erreurs externes deviennent des codes internes.

Exemples :

- `PROVIDER_TIMEOUT` ;
- `AUTH_REVOKED` ;
- `RESOURCE_NOT_FOUND` ;
- `RATE_LIMITED` ;
- `VALIDATION_EXPIRED` : la validation humaine associée à l’appel est expirée, révoquée ou ne couvre plus l’action demandée ;
- `UNKNOWN_OUTCOME`.

`VALIDATION_EXPIRED` est distinct de `PERMISSION_DENIED`. Le premier impose de soumettre une nouvelle demande d’approbation ; le second indique que l’acteur ou le contexte ne possède pas l’autorisation requise.

## 7.9 Compensation

Lorsqu’une séquence partiellement exécutée échoue, une action de compensation peut être nécessaire.

Exemple :

- événement créé ;
- notification échouée ;
- marquer l’état ;
- replanifier ;
- ne pas dupliquer l’événement.

---

# Chapitre 8 — Workflow Engine

## 8.1 Responsabilité

Le Workflow Engine est la source de vérité des séquences automatisées.

Il gère :

- échéances ;
- délais ;
- transitions ;
- événements ;
- reprises ;
- exceptions ;
- pauses ;
- annulations ;
- expirations.

## 8.2 Modèle d’état

Exemple :

```text
created
  |
  v
scheduled
  |
  v
due
  |
  +--> paused
  |      |
  |      +--> scheduled   (reprise après réévaluation)
  |      +--> paused      (prolongation ou nouvelle condition de pause)
  |      +--> cancelled
  |      +--> expired
  |
  +--> cancelled
  |
  +--> expired
  |
  v
processing
  |
  +--> succeeded
  |
  +--> failed
  |
  +--> unknown
```

`expired` est un état métier terminal distinct de `cancelled`. Il s’applique lorsqu’une étape ou une instance dépasse sa fenêtre de validité sans pouvoir être exécutée ou reprise selon les règles versionnées.

Une pause n’expire pas simplement parce que `paused_until` est atteint. Cette date déclenche une réévaluation déterministe qui peut aboutir à :

- une reprise, avec transition vers `scheduled` ;
- une nouvelle pause ;
- une annulation ;
- une expiration.

Le passage direct de `paused` à `processing` est évité : la reprise repasse par `scheduled` afin de persister `next_run_at`, d’appliquer le verrouillage et de conserver une trace uniforme.

## 8.3 Déclencheurs

- date ;
- événement ;
- webhook ;
- action utilisateur ;
- action admin ;
- résultat fournisseur ;
- expiration ;
- reprise.

## 8.4 Règles

Les règles doivent être :

- versionnées ;
- testables ;
- explicites ;
- auditées ;
- indépendantes du prompt.

## 8.5 Exemple EPICU

```text
Invoice due date
   |
   +--> J+5 notification
   |
   +--> J+9 notification
   |
   +--> J+10 payment attempt
   |
   +--> failure handling
```

Les dates réelles dépendent de la configuration produit validée.

## 8.6 Pause

Une pause doit avoir :

- motif ;
- acteur ;
- portée ;
- date ;
- expiration ;
- reprise ;
- audit.

## 8.7 Déclaration de paiement

Une déclaration :

- crée un état ou événement métier ;
- suspend selon la règle ;
- porte une expiration ;
- déclenche une vérification ;
- ne marque pas automatiquement payé.

## 8.8 Paiement partiel

Le moteur doit pouvoir gérer :

- montant total ;
- montant reçu ;
- solde ;
- échéances ;
- reprise du workflow sur le solde.

## 8.9 Promesse de paiement

Une promesse :

- date ;
- montant ;
- provenance ;
- acteur ;
- expiration ;
- action si non tenue.

## 8.10 Concurrence et verrouillage

Le worker sélectionne les tâches dues dans une transaction avec un mécanisme empêchant leur traitement concurrent.

Pour PostgreSQL, la stratégie de référence EPICU V1 est :

```sql
SELECT id
FROM dunning_schedules
WHERE status IN ('scheduled', 'due')
  AND next_run_at <= now()
ORDER BY next_run_at
FOR UPDATE SKIP LOCKED
LIMIT :batch_size;
```

Le verrouillage ne remplace pas l’idempotence. Chaque étape de workflow possède également une contrainte unique persistée dans `workflow_step_executions`, par exemple `(dunning_schedule_id, step_code, scheduled_at)`. La table générique `idempotency_keys` reste utilisée pour les effets de bord transverses ou externes qui ne sont pas naturellement couverts par cette contrainte métier.

## 8.11 Reprise

Le système doit reprendre après :

- redémarrage ;
- indisponibilité ;
- webhook retardé ;
- timeout ;
- incident.

## 8.12 DLQ

Les événements impossibles à traiter sont placés en Dead Letter Queue avec :

- cause ;
- payload sécurisé ;
- tentatives ;
- trace ;
- propriétaire ;
- action manuelle.

---

# Chapitre 9 — Sécurité

## 9.1 Modèle de menace

Menaces principales :

- prompt injection ;
- tool injection ;
- fuite inter-tenant ;
- accès non autorisé ;
- secret exposé ;
- webhook falsifié ;
- replay ;
- duplication financière ;
- escalade de rôle ;
- données obsolètes ;
- exfiltration par résumé ;
- abus de l’agent.

## 9.2 Authentification

Exigences :

- sessions sécurisées ;
- expiration ;
- révocation ;
- MFA pour rôles sensibles si requis ;
- vérification serveur ;
- pas d’identité déclarative.

## 9.3 Autorisation

Le contrôle doit être effectué :

- côté API ;
- côté service ;
- côté base si possible ;
- avant l’outil ;
- avant l’effet de bord.

## 9.4 Row Level Security et contexte de sécurité

### Équivalence de portée EPICU V1

Pour EPICU V1, les termes **compte**, **organisation** et **tenant** désignent la même frontière d’isolation métier. L’entité persistée est `organizations`, identifiée par `organization_id`. Dans les contrats et couches techniques, cette même valeur peut être propagée sous le nom `tenant_id`.

Toute référence historique à `account_id` dans `06_AGENT_TOOLS` ou `07_AGENT_MEMORY` doit être comprise comme l’identifiant de cette même organisation pour la V1. Une évolution vers plusieurs comptes au sein d’une organisation nécessiterait une décision d’architecture et une migration explicites.

Pour Supabase/PostgreSQL :

- RLS activée ;
- politiques par tenant ;
- tests de non-régression ;
- accès `service_role` strictement limité ;
- accès serveur contrôlé ;
- aucun `tenant_id` proposé par le LLM n’est utilisé comme preuve d’autorisation.

### Requêtes issues d’une session utilisateur

Le contexte d’autorisation est dérivé du JWT vérifié de l’utilisateur et de son appartenance réelle à l’organisation. Les Domain Services reçoivent un contexte de sécurité construit côté serveur.

### Workers d’arrière-plan

Un worker sans session utilisateur peut utiliser un rôle technique limité, mais il doit :

- charger l’objet à partir d’un identifiant interne issu d’un job signé ;
- vérifier l’organisation propriétaire en base ;
- exécuter l’opération dans une transaction ;
- appliquer une politique RLS ou une fonction/RPC dédiée et auditée ;
- ne jamais accepter le tenant comme autorité depuis un payload LLM ou un champ externe.

L’emploi de `SET LOCAL app.current_tenant_id` n’est autorisé que si les politiques PostgreSQL utilisent explicitement cette variable, si sa valeur est dérivée côté serveur et si l’ensemble du traitement est encapsulé dans **une transaction explicite unique**.

Avec un pool de connexions, y compris PgBouncer en mode transaction, toutes les requêtes dépendant de cette variable doivent être exécutées dans la même transaction, sur la connexion qui lui est affectée. Il est interdit d’émettre `SET LOCAL` dans une requête autonome puis d’exécuter les requêtes métier dans une transaction ou une connexion différente. Lorsque cette atomicité ne peut pas être garantie par le client utilisé, une fonction RPC transactionnelle dédiée doit appliquer le contexte tenant et réaliser l’opération dans un seul appel.

Une transaction annulée ne doit produire aucun effet métier ; le worker doit alors enregistrer l’échec et relancer l’opération selon sa politique d’idempotence, sans réutiliser implicitement un contexte de session antérieur.

Les fonctions `SECURITY DEFINER`, lorsqu’elles sont nécessaires, doivent avoir une surface minimale, un `search_path` fixé et des tests cross-tenant dédiés.

## 9.5 Secrets

Les secrets :

- ne sont pas stockés en DB applicative en clair ;
- ne sont pas envoyés au LLM ;
- sont séparés par environnement ;
- sont rotatifs ;
- sont audités.

## 9.6 Prompt injection

Mesures :

- séparation instructions/données ;
- étiquetage des sources ;
- filtrage des outils ;
- permission externe ;
- données minimales ;
- validation de sortie ;
- refus de révéler les prompts.

## 9.7 Tool injection

Le nom d’un outil dans un document ou message ne constitue pas un appel.

Seuls les outils du registre courant peuvent être exécutés.

## 9.8 Webhooks

Exigences :

- signature ;
- horodatage ;
- anti-replay ;
- idempotence ;
- stockage brut sécurisé ;
- journalisation ;
- traitement asynchrone.

## 9.9 Chiffrement

- TLS en transit ;
- chiffrement au repos ;
- rotation des clés ;
- segmentation ;
- sauvegardes chiffrées.

## 9.10 Données sensibles

Les données financières et personnelles doivent être :

- minimisées ;
- masquées ;
- restreintes ;
- journalisées avec prudence ;
- exclues des prompts si inutiles.

## 9.11 Journaux

Ne pas loguer :

- secrets ;
- cartes ;
- tokens ;
- mots de passe ;
- payloads complets non nécessaires ;
- documents sensibles sans filtrage.

## 9.12 Sécurité des fournisseurs IA

Évaluer :

- politique de rétention ;
- entraînement ;
- région ;
- chiffrement ;
- sous-traitants ;
- suppression ;
- certifications ;
- mode entreprise.

---

# Chapitre 10 — Résilience

## 10.1 Timeouts

Chaque dépendance possède :

- timeout connexion ;
- timeout réponse ;
- timeout global ;
- comportement de fallback.

## 10.2 Retries

Les retries utilisent :

- backoff exponentiel ;
- jitter ;
- nombre maximal ;
- classification ;
- idempotence.

## 10.3 Fallback LLM

Le système peut :

- changer de modèle ;
- réduire le contexte ;
- produire une réponse non-actionnable ;
- transmettre ;
- revenir à un formulaire.

Il ne doit pas assouplir les permissions.

## 10.4 Mode dégradé

Exemples :

- consultation disponible, actions suspendues ;
- mémoire indisponible, réponse sans personnalisation ;
- fournisseur comptable indisponible, statut non vérifié ;
- LLM indisponible, workflows automatiques maintenus.

## 10.5 Résultat inconnu et réconciliation

Lorsqu’un effet de bord peut avoir eu lieu :

- ne pas retenter immédiatement ;
- conserver les identifiants fournisseur et d’idempotence ;
- marquer l’opération externe `unknown`, puis ouvrir un dossier de réconciliation au statut `pending_reconciliation` ; ce statut appartient à l’opération ou à `reconciliation_cases`, et non au graphe d’état de `dunning_schedules` ;
- suspendre les actions incompatibles sur l’objet concerné ;
- déclencher automatiquement le Reconciliation Worker ;
- interroger la source autoritative ;
- reprendre le workflow uniquement après obtention d’un état vérifié.

Politique initiale EPICU V1 :

- première réconciliation ciblée à T+15 minutes ;
- nouvelles tentatives avec backoff ;
- alerte humaine au plus tard à T+2 heures ;
- aucun objet financier ne reste indéfiniment en état inconnu.

Ces délais sont configurables et doivent être confirmés avant production.

## 10.6 Sauvegardes

- fréquence ;
- rétention ;
- chiffrement ;
- restauration testée ;
- séparation ;
- objectifs RPO/RTO.

## 10.7 Recovery

Un runbook doit couvrir :

- panne DB ;
- webhook en retard ;
- queue bloquée ;
- fournisseur indisponible ;
- fuite de secret ;
- erreur de migration ;
- doublon d’action ;
- dérive de coûts.

---

# Chapitre 11 — Observabilité

## 11.1 Logs

Chaque interaction doit pouvoir être corrélée par :

- `request_id` ;
- `trace_id` ;
- `conversation_id` ;
- `tool_call_id` ;
- `operation_id` ;
- `tenant_id` pseudonymisé si nécessaire.

## 11.2 Métriques techniques

- latence ;
- taux d’erreur ;
- disponibilité ;
- queue depth ;
- retries ;
- timeouts ;
- DB saturation ;
- cache hit rate.

## 11.3 Métriques IA

- latence modèle ;
- tokens ;
- coût ;
- taux de tool call ;
- taux d’arguments invalides ;
- taux de refus ;
- fallback ;
- réponses vides ;
- hallucinations détectées ;
- taux de clarification.

## 11.4 Métriques métier

- relances planifiées ;
- relances envoyées ;
- paiements déclarés ;
- paiements confirmés ;
- suspensions ;
- reprises ;
- échecs ;
- interventions humaines.

## 11.5 Tracing

Une trace doit montrer :

```text
request
 -> context
 -> prompt
 -> model
 -> tool
 -> domain service
 -> provider
 -> result
 -> response
```

## 11.6 Alertes

Alertes critiques :

- cross-tenant ;
- doublon financier ;
- secret exposé ;
- taux d’échec outil ;
- queue bloquée ;
- webhook rejeté ;
- coût anormal ;
- latence extrême ;
- dérive de permission.

## 11.7 Audit métier

L’audit doit permettre de répondre :

- qui ;
- quoi ;
- quand ;
- sur quel objet ;
- les arguments significatifs de l’appel, avec masquage ou exclusion des données sensibles ;
- avec quelle permission ;
- avec quel niveau d’autonomie ;
- si une validation humaine était requise ;
- quelle approbation humaine a été utilisée, le cas échéant ;
- avec quel résultat ;
- avec quel identifiant d’idempotence, le cas échéant ;
- avec quelle version de règle ;
- avec quel modèle ;
- avec quel outil.

---

# Chapitre 12 — Scalabilité

## 12.1 Principes

- stateless lorsque possible ;
- queues pour les tâches longues ;
- séparation lecture/écriture ;
- cache ciblé ;
- workers horizontaux ;
- index adaptés ;
- pagination ;
- limites.

## 12.2 Multi-tenant

Options :

- schéma partagé avec `tenant_id` ;
- RLS ;
- index composites ;
- quotas ;
- clés de partition ;
- stockage séparé pour clients sensibles.

## 12.3 Conversations

Le stockage de conversation doit être paginé, résumé et archivé.

## 12.4 LLM

Pour maîtriser l’échelle :

- cache de contexte non sensible ;
- modèle rapide pour tâches simples ;
- compression ;
- quotas ;
- streaming ;
- batch pour tâches offline.

## 12.5 Queues

Séparer éventuellement :

- paiements ;
- notifications ;
- webhooks ;
- mémoire ;
- rapports ;
- maintenance.

## 12.6 Limites et quotas IA

Définir :

- messages par minute ;
- tool calls ;
- longueur ;
- taille de documents ;
- opérations simultanées ;
- coût quotidien et mensuel ;
- tokens par organisation ;
- mémoire par tenant.

EPICU V1 conserve les consommations dans `tenant_usage_limits` et `tenant_usage_counters`. La LLM Gateway vérifie le quota avant l’appel et incrémente les compteurs à partir de l’usage réellement retourné par le fournisseur.

Les plafonds commerciaux exacts dépendent des plans Sidian et restent à valider avant production. Un plafond interne global et une alerte de dérive sont obligatoires même si aucun quota n’est affiché au client.

---

# Chapitre 13 — Déploiement et exploitation

## 13.1 Environnements

- local ;
- développement ;
- test ;
- staging ;
- production.

## 13.2 Données

Aucune donnée de production dans dev/test sans anonymisation et autorisation.

## 13.3 CI/CD

Pipeline recommandé :

1. lint ;
2. tests ;
3. sécurité ;
4. migrations ;
5. build ;
6. staging ;
7. smoke tests ;
8. déploiement progressif ;
9. vérification ;
10. rollback si nécessaire.

## 13.4 Migrations

Les migrations doivent être :

- versionnées ;
- réversibles si possible ;
- testées ;
- observées ;
- compatibles avec déploiement progressif.

## 13.5 Feature flags

Utiles pour :

- nouveau modèle ;
- nouvel outil ;
- nouvelle mémoire ;
- nouveau workflow ;
- nouvelle permission ;
- nouveau fournisseur.

## 13.6 Déploiement LLM

Le changement de modèle doit être traité comme une modification produit.

Il nécessite :

- évaluations ;
- tests ;
- comparaison ;
- canary ;
- monitoring ;
- rollback.

## 13.7 Runbooks

Runbooks minimum :

- LLM indisponible ;
- Stripe indisponible ;
- Pennylane indisponible ;
- queue bloquée ;
- webhook invalide ;
- mémoire corrompue ;
- fuite de secret ;
- migration échouée ;
- cross-tenant suspect.

---

# Chapitre 14 — Architecture EPICU V1

## 14.1 Objectif

EPICU V1 doit privilégier une architecture simple, sûre et extensible.

## 14.2 Stack indicative et modèle de déploiement

EPICU V1 adopte un **monolithe modulaire**. Les modules peuvent être déployés ensemble au départ, tandis que les traitements longs sont exécutés par des workers séparés de la requête HTTP.

- Frontend : Next.js ;
- Backend applicatif : Next.js server actions / API routes ou service Node dédié ;
- Base : PostgreSQL via Supabase ;
- Auth : Supabase Auth ;
- RLS : Supabase/PostgreSQL ;
- Paiement : Stripe ;
- Comptabilité : Pennylane ;
- Queue / jobs : service managé ou table de jobs au départ ;
- LLM : fournisseur abstrait via LLM Gateway ;
- Observabilité : logs structurés + monitoring ;
- Secrets : gestionnaire du fournisseur d’hébergement.

Ces choix restent indicatifs.

## 14.3 Modules

### Auth

- login ;
- signup ;
- session ;
- rôle ;
- tenant.

### Clients

- création ;
- modification ;
- archivage ;
- recherche.

### Contrats

- création ;
- statut ;
- montant ;
- échéance ;
- lien client.

### Factures

- import ;
- statut ;
- échéance ;
- montant ;
- source.

### Enrollment / autorisation de paiement

- activation de la collaboration ;
- autorisation de paiement future ;
- version du texte accepté ;
- statut autoritatif ;
- révocation, suspension et expiration.

Dans EPICU V1, `enrollment` est un **concept fonctionnel**, pas une seconde machine d’état indépendante. Le modèle autoritatif est `payment_authorization`, défini dans `SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`.

Les états canoniques restent : `NON_PROPOSÉE`, `PROPOSÉE`, `EN_CONFIGURATION`, `ACTIVE`, `REFUSÉE`, `EXPIRÉE`, `SUSPENDUE` et `RÉVOQUÉE`. Seule une autorisation `ACTIVE`, compatible avec la relation prestataire/client et marquée comme autorisation par défaut selon le document 03, peut rendre une tentative automatique éligible. Le présent document ne crée aucun état supplémentaire et ne remplace pas les contraintes SQL ni les transitions définies dans le document 03.

### Paiements

- moyen de paiement ;
- intention ;
- tentative ;
- résultat ;
- retry ;
- audit.

### Alertes

- échéance ;
- incident ;
- échec ;
- contradiction ;
- besoin humain.

### Agent

- conversation ;
- contexte ;
- LLM ;
- outils ;
- mémoire ;
- audit.

## 14.4 Tables indicatives et objets structurants

### Identité et organisation

- `profiles` ;
- `organizations` ;
- `organization_members` ;
- `organization_settings` ;
- `tenant_usage_limits` ;
- `tenant_usage_counters`.

### Domaine commercial et financier

- `clients` ;
- `contracts` ;
- `invoices` ;
- `payment_authorization` — objet canonique du concept fonctionnel d’enrollment, défini par le document 03 ;
- `payment_intents` ;
- `payment_attempts` ;
- `payment_declarations` ;
- `payment_promises` ;
- `payment_allocations`.

`payment_allocations` rattache les montants réellement reçus aux factures et permet de calculer sans ambiguïté le solde restant. Les champs agrégés tels que `paid_amount` et `remaining_balance` peuvent être stockés pour performance, mais doivent être recalculables depuis les allocations vérifiées.

### Workflow et exécution

- `workflow_definitions` ;
- `dunning_schedules` ;
- `workflow_step_executions` ;
- `background_jobs` ;
- `idempotency_keys` ;
- `reconciliation_cases`.

Pour EPICU V1, `dunning_schedules` est le nom concret de la table qui implémente le concept générique de `workflow_instances`. Une définition unique versionnée peut suffire au lancement. `dunning_schedules` porte au minimum :

- `tenant_id` ;
- `invoice_id` ;
- `definition_version` ;
- `current_step` ;
- `status` ;
- `next_run_at` ;
- `paused_until` ;
- `pause_reason` ;
- `expires_at` : date limite de validité de l’instance, évaluée par les règles versionnées ;
- `locked_at` ;
- `completed_at`.

### Événements, notifications et audit

- `alerts` ;
- `activity_events` ;
- `webhook_events` ;
- `notifications` ;
- `audit_events`.

### Agent

- `conversations` ;
- `conversation_messages` ;
- `memories` ;
- `agent_runs` ;
- `tool_calls` ;
- `approval_requests`.

### Cycle de vie des déclarations et promesses

Une `payment_declaration` possède notamment :

- montant déclaré ;
- date déclarée ;
- auteur ;
- référence de preuve éventuelle ;
- statut `pending_verification | verified | rejected | expired` ;
- `expires_at`.

Une `payment_promise` possède notamment :

- montant promis ;
- date promise ;
- auteur ;
- statut `active | fulfilled | broken | cancelled | expired` ;
- date de prochaine évaluation.

Ni l’une ni l’autre ne modifie directement le statut vérifié d’une facture.

## 14.5 Architecture agent V1

```text
Chat UI
  |
  v
Agent API
  |
  v
Orchestrator
  |
  +--> Context Builder
  |       +--> Supabase
  |       +--> Memory
  |       +--> Permissions
  |
  +--> LLM Gateway
  |
  +--> Tool Router
          +--> Clients
          +--> Contracts
          +--> Invoices
          +--> Payments
          +--> Alerts
```

## 14.6 Architecture workflow V1

```text
Cron / Scheduler
  |
  v
Background Job Engine
  |
  +--> sélectionner les workflows dus
  +--> verrouiller avec FOR UPDATE SKIP LOCKED
  +--> vérifier l’idempotency key
  +--> évaluer la règle versionnée
  +--> persister l’exécution de l’étape
  +--> appeler le service de domaine ou le fournisseur
  +--> persister le résultat
  +--> émettre un événement
  +--> planifier l’étape suivante
```

Le scheduler ne génère pas lui-même de contenu conversationnel. Lorsqu’une formulation assistée par LLM est requise, il appelle le Batch Prompt Generation Service, puis applique un template de secours déterministe si cette génération échoue.

Les traitements restent hors de la requête HTTP Next.js. La technologie de jobs doit être sélectionnée avant implémentation parmi une solution managée compatible avec l’hébergement retenu. Le contrat d’architecture exige au minimum : exécution différée, retries contrôlés, idempotence, planification, visibilité des échecs et DLQ ou équivalent.

## 14.7 Intégration Stripe

Règles :

- SetupIntent pour enregistrer un moyen de paiement ;
- aucun secret dans le LLM ;
- webhooks signés ;
- idempotency key ;
- état inconnu géré ;
- résultat stocké ;
- événements audités.

## 14.8 Intégration Pennylane

Règles :

- OAuth ;
- tokens chiffrés ;
- scopes minimaux ;
- rafraîchissement ;
- révocation ;
- import idempotent ;
- mapping ;
- synchronisation observable ;
- indisponibilité gérée.

## 14.9 Mémoire V1

Inclure :

- préférences simples ;
- résumé conversationnel ;
- décisions utilisateur ;
- contradictions ;
- références métier.

Exclure initialement :

- profilage ;
- mémoire vectorielle générale ;
- auto-apprentissage ;
- mémoire procédurale modifiable librement ;
- extraction de caractéristiques sensibles.

## 14.10 Outils V1

Catégories :

- lecture client ;
- lecture contrat ;
- lecture facture ;
- lecture paiement ;
- création brouillon ;
- demande d’approbation ;
- ajout note ;
- suspension contrôlée ;
- reprise contrôlée ;
- consultation audit.

## 14.11 Autonomie V1

La V1 applique exactement les niveaux définis par `04_AGENT_CONSTITUTION.md` :

- **Niveau 1 — Agir automatiquement :** consultation et exécution sans validation immédiate uniquement lorsque l’action est explicitement déléguée, déterministe, autorisée, maîtrisée, suffisamment réversible et traçable ;
- **Niveau 2 — Conseiller :** formulation d’options et d’une recommandation lorsqu’un jugement est nécessaire, sans produire l’effet de bord à la place du prestataire ;
- **Niveau 3 — Demander une validation :** préparation de l’action, paramètres figés et exécution suspendue jusqu’à une validation humaine valide ;
- **Niveau 4 — Transmettre sans recommander fermement :** transmission lorsque le risque juridique est élevé, qu’un litige est actif, que les informations sont contradictoires, que les permissions ne sont pas confirmées ou que la situation dépasse la mission ;
- **Refus :** obligatoire lorsque l’action est interdite ou qu’aucune permission valide ne peut être obtenue.

Une action financière n’est jamais rendue autonome par sa seule présence dans un workflow. Son niveau dépend de la Constitution, des permissions effectives, du registre d’outils et des règles métier déterministes.

## 14.12 Limites V1

- pas de multi-agent ;
- pas de décision contractuelle autonome ;
- pas de suppression irréversible par LLM ;
- pas de changement de permission ;
- pas de modification du moteur ;
- pas d’accès direct DB ;
- pas de mémoire sensible autonome.

---

# Chapitre 15 — Critères de validation

Le document est opérationnel si un développeur peut :

1. distinguer le rôle du LLM, du moteur, des outils et de la mémoire ;
2. implémenter une requête agent de bout en bout ;
3. vérifier une permission hors du LLM ;
4. empêcher un accès cross-tenant ;
5. exécuter un outil de manière idempotente ;
6. traiter un résultat inconnu ;
7. suivre une opération asynchrone ;
8. vérifier et dédupliquer un webhook ;
9. construire un contexte borné ;
10. expliquer la provenance d’une donnée ;
11. reprendre un workflow après incident ;
12. observer le coût et la latence du LLM ;
13. déployer un nouveau modèle de manière progressive ;
14. restaurer le service en mode dégradé ;
15. appliquer l’architecture EPICU V1 sans inventer de règle fondamentale.

---

# Scénarios minimaux à couvrir lors de la review

- consultation simple sans outil ;
- lecture de facture ;
- tool call autorisé ;
- tool call refusé ;
- permission expirée ;
- utilisateur d’un autre tenant ;
- injection dans un document ;
- injection dans un résultat d’outil ;
- sortie LLM invalide ;
- fournisseur LLM indisponible ;
- Stripe timeout ;
- Pennylane indisponible ;
- webhook dupliqué ;
- webhook falsifié ;
- résultat de paiement inconnu ;
- retry idempotent ;
- retry interdit ;
- pause avec expiration ;
- déclaration de paiement ;
- paiement partiel ;
- promesse de paiement ;
- mémoire obsolète ;
- suppression mémoire ;
- queue bloquée ;
- reprise après redémarrage ;
- migration échouée ;
- rollback ;
- coût IA anormal ;
- cross-tenant détecté ;
- mode dégradé ;
- changement de modèle ;
- fallback de modèle ;
- outil obsolète ;
- feature flag désactivé ;
- audit complet.

---

# Intégration de la review produit Gemini — v1.1

Corrections intégrées :

- persistance du Workflow Engine et ajout de `organization_settings` ;
- suppression du polling synchrone dans les routes conversationnelles ;
- clarification du contexte RLS et interdiction de faire confiance au tenant proposé par le LLM ;
- modélisation métier des déclarations, promesses et règlements partiels ;
- adoption explicite du monolithe modulaire pour EPICU V1 ;
- isolation structurelle des données tierces non fiables ;
- ajout du Reconciliation Worker et d’une politique initiale pour les états `unknown` ;
- verrouillage transactionnel `FOR UPDATE SKIP LOCKED` et idempotence persistée ;
- quotas et suivi des coûts LLM par organisation ;
- séparation entre Agent conversationnel et génération batch ;
- report du Model Router dynamique après le MVP.

Points conservés avec nuance :

- les balises XML constituent un format d’encapsulation, pas une protection suffisante à elles seules ;
- l’usage de `service_role` n’est pas interdit de manière absolue pour les workers, mais il est encadré par un contexte serveur vérifié, une portée minimale et des protections base de données ;
- les durées T+15 minutes et T+2 heures sont des valeurs initiales à confirmer, non des règles produit verrouillées.

# Intégration de la review croisée Claude — v1.2

Corrections intégrées dans le document 08 :

- alignement intégral du Tool Registry sur les champs obligatoires de `06_AGENT_TOOLS`, dont l’autonomie maximale et la validation humaine ;
- distinction explicite entre ordre d’assemblage du contexte et priorité normative de `05_AGENT_PROMPTS` ;
- ajout de l’état terminal `expired` au Workflow Engine ;
- équivalence explicite entre compte, organisation et tenant pour EPICU V1 ;
- rattachement de tous les composants aux trois ensembles du monolithe modulaire ou à l’infrastructure transverse ;
- choix unique de `dunning_schedules` comme table concrète de workflow V1 ;
- clarification de la localisation des contraintes d’idempotence ;
- ajout de la validation humaine aux informations retrouvables dans l’audit.

Correction documentaire externe :

- appliquée dans `04_AGENT_CONSTITUTION` v2.2 puis consolidée en v2.3 : `08_AGENT_ARCHITECTURE.md` précède `09_AGENT_EVALUATIONS.md` dans la hiérarchie.

Correction documentaire associée :

- la génération batch est désormais mentionnée explicitement dans `05_AGENT_PROMPTS` v1.3, sans modifier l’ordre normatif ni les principes de sécurité.

# Intégration de la Gate Review finale — v1.3

Corrections appliquées :

- ajout de l’identifiant unique et du type lecture/écriture dans le Tool Registry ;
- ajout du code `VALIDATION_EXPIRED`, distinct de `PERMISSION_DENIED` ;
- complétion du graphe de reprise depuis l’état `paused` ;
- ajout de `expires_at` à `dunning_schedules` ;
- clarification transactionnelle de `SET LOCAL` avec les pools de connexions ;
- complétion de l’audit avec arguments significatifs, niveau d’autonomie et identifiant d’idempotence ;
- mise à jour du statut de la correction de hiérarchie documentaire ;
- synchronisation avec `04_AGENT_CONSTITUTION` v2.3 et `05_AGENT_PROMPTS` v1.3.

# Intégration de la revue de cohérence 04–09 — v1.4

Corrections intégrées :

- synchronisation avec `04_AGENT_CONSTITUTION` v2.4 et `05_AGENT_PROMPTS` v1.3 ;
- ajout effectif de la section de génération batch manquante dans le document 05 ;
- alignement de l’exemple `autonomy.maximum_level` sur les niveaux numériques 1 à 4 de la Constitution et du document Tools ;
- suppression du nombre obsolète de composants assimilables à des services ;
- alignement de la requête de verrouillage sur les états réels `scheduled` et `due` ;
- clarification du fait que `pending_reconciliation` appartient à l’opération externe ou au dossier de réconciliation, pas au workflow de relance ;
- clarification du suivi asynchrone sans polling conversationnel ;
- validation de la couverture par `09_AGENT_EVALUATIONS`.

Aucune nouvelle permission, règle métier ou capacité autonome n’est créée par cette révision.

# Journal des décisions de rédaction

| Révision | Décision | Statut |
|---|---|---|
| R1 | Séparation stricte LLM / outils / moteur déterministe | Acceptée |
| R1 | Permission vérifiée hors du LLM | Acceptée |
| R1 | Mémoire non autoritative | Acceptée |
| R1 | Architecture multi-tenant avec isolation en profondeur | Acceptée |
| R1 | Tool Router centralisé | Acceptée |
| R1 | Workflow Engine déterministe | Acceptée |
| R1 | Webhooks vérifiés, dédupliqués et asynchrones | Acceptée |
| R1 | Résilience fondée sur idempotence, retries contrôlés et état inconnu | Acceptée |
| R1 | Observabilité complète agent + métier | Acceptée |
| R1 | Architecture EPICU V1 volontairement simple | Acceptée |
| R2 | Monolithe modulaire officiel pour EPICU V1 | Intégré |
| R2 | Aucun polling asynchrone dans la requête HTTP conversationnelle | Intégré |
| R2 | Contexte tenant dérivé uniquement d’une identité ou d’un job serveur vérifié | Intégré |
| R2 | Persistance des workflows, déclarations, promesses et allocations | Intégré |
| R2 | Réconciliation automatique des états externes inconnus | Intégré |
| R2 | Verrouillage transactionnel et quotas IA | Intégré |
| R2 | Séparation de la génération batch et de l’agent conversationnel | Intégré |
| R3 | Tool Registry aligné sur le document 06 | Intégré |
| R3 | Priorité normative distinguée de l’ordre d’assemblage | Intégré |
| R3 | État `expired` ajouté au Workflow Engine | Intégré |
| R3 | Équivalence compte / organisation / tenant explicitée | Intégré |
| R3 | Propriétaires de tous les composants clarifiés | Intégré |
| R3 | Nom concret `dunning_schedules` harmonisé | Intégré |
| R3 | Audit et idempotence précisés | Intégré |
| R4 | Code `VALIDATION_EXPIRED` ajouté | Intégré |
| R4 | Reprise depuis `paused` explicitée dans le graphe | Intégré |
| R4 | `expires_at` ajouté à `dunning_schedules` | Intégré |
| R4 | Contraintes transactionnelles de `SET LOCAL` clarifiées | Intégré |
| R4 | Tool Registry et audit complétés | Intégré |
| R1 | SQL prioritaire pour la mémoire V1 | Acceptée |
| R1 | Indépendance du fournisseur de LLM | Acceptée |
| R5 | Revue de cohérence documentaire 04–09 | Intégré |
| R5 | Alignement états workflow, autonomie et suivi asynchrone | Intégré |

---

# Statut de revue

- Review produit Gemini : **intégrée dans la v1.1**
- Review croisée Claude : **intégrée dans la v1.2**
- Gate Review finale : **intégrée dans la v1.3**
- Revue de cohérence 04–09 : **intégrée dans la v1.4**
- Dépendances vérifiées : `04_AGENT_CONSTITUTION.md`, `05_AGENT_PROMPTS.md`, `06_AGENT_TOOLS.md`, `07_AGENT_MEMORY.md`
- Couverture d’évaluation vérifiée : `09_AGENT_EVALUATIONS.md`
- Document officiel : **verrouillé**
- Verrouillage : **oui**


# Addendum de correction v1.5

Cette révision ferme trois ambiguïtés sans modifier les principes supérieurs :

- le Model Router est explicitement hors périmètre EPICU V1 ;
- le concept d’enrollment est aligné sur l’objet canonique `payment_authorization` et sa machine d’état définie dans le document 03 ;
- les niveaux d’autonomie reprennent exactement les niveaux 1 à 4 de la Constitution.
