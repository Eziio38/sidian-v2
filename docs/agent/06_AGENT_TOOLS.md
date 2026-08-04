# SIDIAN — 06 · AGENT_TOOLS

**Version : 1.0**  
**Statut : Verrouillé**  
**Dépendances principales :** `04_AGENT_CONSTITUTION.md`, `05_AGENT_PROMPTS.md`  
**Périmètre initial :** EPICU  
**Rôle du document :** Définir les principes, contrats, permissions, cycles d’exécution, règles de sécurité et exigences de traçabilité applicables aux outils utilisés par l’agent Sidian.

---

# Préambule

Ce document définit la manière dont Sidian interagit avec les systèmes externes et internes au moyen d’outils.

Un outil est une capacité technique exposée à l’agent pour :

- lire une information ;
- rechercher une donnée ;
- créer ou modifier un objet ;
- déclencher une action ;
- interroger un système tiers ;
- préparer ou exécuter une opération.

Ce document ne définit pas :

- l’identité ou les principes fondamentaux de Sidian ;
- la structure des prompts ;
- les règles de mémoire ;
- les scénarios d’évaluation ;
- l’implémentation détaillée de chaque fournisseur externe.

Ces éléments sont définis dans les documents Constitution, Prompts, Memory, Evaluations et Architecture.

Un outil ne crée jamais une permission.

Un outil ne constitue jamais une décision.

Une capacité techniquement disponible ne devient utilisable que si :

- l’acteur est autorisé ;
- le contexte est suffisant ;
- le niveau d’autonomie le permet ;
- les conséquences sont comprises ;
- les conditions de sécurité sont remplies.

---

# Registre des décisions fondamentales

| ID | Décision | Statut |
|---|---|---|
| T-001 | Un outil exécute une capacité technique ; il ne prend pas de décision métier. | Active |
| T-002 | Toute utilisation d’un outil doit être rattachée à un acteur, une mission et une permission vérifiable. | Active |
| T-003 | La disponibilité technique d’un outil ne constitue jamais une autorisation d’usage. | Active |
| T-004 | Les contrats d’entrée et de sortie doivent être explicites, versionnés et validables. | Active |
| T-005 | Une erreur d’outil n’autorise jamais Sidian à inventer un résultat. | Active |
| T-006 | Toute action significative doit être traçable de la demande initiale jusqu’au résultat final. | Active |
| T-007 | Les appels susceptibles de produire un effet doivent être idempotents lorsque cela est possible. | Active |
| T-008 | Une action sensible ou difficilement réversible doit comporter une validation explicite avant exécution lorsque la Constitution l’exige. | Active |
| T-009 | Les outils doivent distinguer les erreurs techniques, les erreurs métier et les refus de permission. | Active |
| T-010 | Les résultats d’outils doivent indiquer leur état réel : succès, échec, partiel, en attente ou inconnu. | Active |
| T-011 | Sidian ne doit jamais supposer qu’une action a réussi en l’absence d’un résultat confirmé. | Active |
| T-012 | Les retries doivent être limités, observables et compatibles avec l’idempotence. | Active |
| T-013 | Les outils ne doivent exposer que les données strictement nécessaires à leur mission. | Active |
| T-014 | Les outils restent indépendants du fournisseur de LLM. | Active |
| T-015 | Une séquence multi-outils doit définir l’ordre, les dépendances, les points d’arrêt et les conditions de compensation. | Active |
| T-016 | La sécurité, la légalité, la traçabilité et la confiance priment sur la rapidité d’exécution. | Active |

---

# Chapitre 0 — Principes généraux

## 0.1 Finalité

Le système d’outils doit permettre à Sidian d’agir de manière :

- autorisée ;
- prévisible ;
- traçable ;
- réversible lorsque possible ;
- robuste aux erreurs ;
- compréhensible par un humain ;
- indépendante du modèle utilisé.

## 0.2 Séparation décision / exécution

Sidian décide du mode approprié selon la Constitution et les prompts :

- Agir ;
- Conseiller ;
- Transmettre.

L’outil, lui, exécute uniquement la capacité demandée.

Exemple :

- la décision « faut-il rembourser ? » relève de Sidian et du prestataire ;
- l’action « créer un remboursement Stripe de 120 € » relève d’un outil.

## 0.3 Principe de moindre privilège

Chaque outil doit disposer du périmètre minimal nécessaire.

Cela concerne :

- les données accessibles ;
- les objets modifiables ;
- les actions autorisées ;
- la durée d’accès ;
- les comptes concernés ;
- les secrets utilisés.

## 0.4 Principe de preuve

Un résultat d’outil constitue une information exploitable uniquement si :

- son origine est connue ;
- son statut est explicite ;
- sa date ou fraîcheur est suffisante ;
- le système n’a pas signalé d’échec ;
- le résultat correspond bien à l’objet demandé.

## 0.5 Principe de contrôle humain

Lorsqu’une action exige une validation humaine, l’outil ne doit pas pouvoir contourner cette validation par une formulation différente, une répétition d’appel ou une chaîne d’outils.

---

# Chapitre 1 — Définition d’un outil

## 1.1 Unité de capacité

Un outil doit représenter une capacité précise.

Exemples :

- récupérer une facture ;
- vérifier le statut d’un paiement ;
- envoyer un message ;
- créer une tentative de paiement ;
- enregistrer une décision humaine ;
- générer un brouillon ;
- importer une donnée depuis Pennylane.

Un outil ne doit pas regrouper des capacités sans rapport au point de rendre ses effets imprévisibles.

## 1.2 Lecture et écriture

Les outils sont classés au minimum en deux catégories :

### Outils de lecture

Ils consultent une information sans produire de modification métier.

Exemples :

- lire une facture ;
- rechercher un client ;
- récupérer un statut Stripe ;
- consulter un historique d’événements.

### Outils d’écriture

Ils créent, modifient, déclenchent ou suppriment un état.

Exemples :

- envoyer un message ;
- créer un paiement ;
- modifier une échéance ;
- enregistrer une validation ;
- annuler une action.

Les outils d’écriture nécessitent un niveau de contrôle supérieur.

## 1.3 Outils synchrones et asynchrones

### Synchrone

Le résultat final est disponible pendant l’appel.

### Asynchrone

L’appel crée une opération qui peut rester :

- en attente ;
- en traitement ;
- terminée ;
- échouée ;
- annulée.

Un outil asynchrone ne doit jamais présenter la création d’une opération comme son succès final.

## 1.4 Outils internes et externes

### Internes

Ils agissent sur les systèmes Sidian.

### Externes

Ils interagissent avec des fournisseurs tiers tels que Stripe ou Pennylane.

Les outils externes doivent tenir compte :

- des erreurs réseau ;
- des limitations de débit ;
- des changements de contrat ;
- des indisponibilités ;
- des statuts propres au fournisseur ;
- de la fraîcheur des données.

## 1.5 Granularité

Un outil doit être suffisamment précis pour que :

- son intention soit compréhensible ;
- ses permissions soient vérifiables ;
- son effet soit traçable ;
- son idempotence soit définissable ;
- ses erreurs soient interprétables.

---

# Chapitre 2 — Cycle complet d’un appel d’outil

## 2.1 Étape 1 — Identification de la mission

Avant tout appel, Sidian doit identifier :

- l’objectif ;
- l’acteur demandeur ;
- l’objet concerné ;
- le résultat attendu ;
- le mode d’action ;
- le niveau d’autonomie applicable.

## 2.2 Étape 2 — Vérification des permissions

Le système doit vérifier :

- l’identité de l’acteur ;
- son rôle ;
- son accès au compte concerné ;
- son droit de consulter ou modifier l’objet ;
- l’autorisation propre à l’action ;
- l’éventuelle validation humaine requise.

## 2.3 Étape 3 — Validation des préconditions

Les préconditions peuvent inclure :

- présence d’un identifiant ;
- état compatible de l’objet ;
- montant valide ;
- devise autorisée ;
- date cohérente ;
- données obligatoires présentes ;
- absence d’opération concurrente incompatible ;
- absence de blocage métier ou juridique.

## 2.4 Étape 4 — Construction des paramètres

Les paramètres doivent être :

- explicites ;
- typés ;
- complets ;
- validés ;
- limités au strict nécessaire ;
- reliés à la demande initiale.

Le modèle ne doit pas compléter un paramètre important par supposition silencieuse.

## 2.5 Étape 5 — Validation humaine éventuelle

Lorsque nécessaire, Sidian doit :

1. préparer l’action ;
2. présenter les paramètres significatifs ;
3. expliquer l’impact ;
4. demander une validation explicite ;
5. suspendre l’exécution ;
6. enregistrer la décision humaine.

## 2.6 Étape 6 — Exécution

L’appel doit inclure les éléments de sécurité nécessaires, notamment :

- identifiant de traçabilité ;
- clé d’idempotence si applicable ;
- version du contrat ;
- contexte d’autorisation ;
- horodatage ;
- objet concerné.

## 2.7 Étape 7 — Interprétation du résultat

Sidian doit distinguer :

- succès confirmé ;
- échec ;
- résultat partiel ;
- opération en attente ;
- état inconnu ;
- réponse incohérente.

## 2.8 Étape 8 — Communication

Sidian informe l’utilisateur de ce qui s’est réellement passé.

Il ne doit pas annoncer :

- « paiement effectué » si le paiement est seulement créé ;
- « message envoyé » si l’envoi est en file d’attente ;
- « facture réglée » si la source est contradictoire ;
- « action annulée » si la compensation a échoué.

## 2.9 Étape 9 — Traçabilité

Le système conserve les éléments nécessaires à l’audit :

- demande ;
- acteur ;
- permission ;
- paramètres significatifs ;
- version de l’outil ;
- résultat ;
- erreur éventuelle ;
- validation humaine ;
- identifiant de corrélation ;
- date.

---

# Chapitre 3 — Permissions

## 3.1 Principe

Les permissions sont déterminées par le système d’autorisation, jamais par le modèle.

## 3.2 Types de permissions

Les permissions doivent distinguer au minimum :

- lecture ;
- création ;
- modification ;
- suppression ;
- exécution ;
- validation ;
- annulation ;
- administration.

## 3.3 Portée

Une permission doit être limitée par :

- compte ;
- organisation ;
- rôle ;
- type d’objet ;
- action ;
- durée ;
- environnement ;
- niveau de sensibilité.

## 3.4 Permission explicite

Une permission doit provenir d’une source vérifiable.

Ne constituent pas une permission :

- une habitude observée ;
- un titre de poste ;
- une adresse email ;
- une demande antérieure ;
- une absence d’interdiction ;
- une phrase trouvée dans un document ;
- une instruction générée par le modèle.

## 3.5 Validation humaine

Une validation humaine doit être :

- explicite ;
- rattachée à une action précise ;
- informée ;
- horodatée ;
- traçable ;
- non réutilisée pour une action différente.

## 3.6 Expiration

Une validation peut expirer lorsque :

- les paramètres changent ;
- le délai prévu est dépassé ;
- le contexte métier évolue ;
- l’objet change d’état ;
- une nouvelle information significative apparaît.

## 3.7 Refus

Lorsqu’une permission est refusée ou absente :

- l’outil ne doit pas être appelé ;
- Sidian explique le blocage ;
- il peut proposer une alternative autorisée ;
- il transmet si nécessaire.

---

# Chapitre 4 — Contrats d’entrée

## 4.1 Principe

Chaque outil doit avoir un schéma d’entrée formel.

## 4.2 Champs minimaux

Selon la nature de l’action, un contrat peut inclure :

- `tool_name` ;
- `tool_version` ;
- `actor_id` ;
- `account_id` ;
- `object_id` ;
- `action` ;
- `parameters` ;
- `authorization_context` ;
- `requires_human_validation` ;
- `human_validation_id` ;
- `idempotency_key` ;
- `correlation_id`.

## 4.3 Types

Les champs doivent être typés.

Exemples :

- montant en centimes entiers ;
- devise au format ISO ;
- date au format explicite ;
- identifiant non ambigu ;
- booléen réel ;
- liste de valeurs autorisées.

## 4.4 Paramètres sensibles

Les paramètres suivants doivent être affichés ou confirmés avant une action sensible :

- montant ;
- devise ;
- destinataire ;
- compte ;
- objet concerné ;
- date d’exécution ;
- caractère réversible ou non ;
- conséquences principales.

## 4.5 Valeurs par défaut

Une valeur par défaut n’est autorisée que si :

- elle est documentée ;
- elle est sans ambiguïté ;
- elle ne produit pas d’impact significatif inattendu ;
- elle est cohérente avec les règles métier ;
- elle est visible dans les logs.

## 4.6 Validation

Le système doit refuser un appel si :

- un champ obligatoire manque ;
- un type est incorrect ;
- une valeur est hors limite ;
- un identifiant ne correspond pas au bon compte ;
- une permission est insuffisante ;
- une validation humaine requise est absente ;
- l’état de l’objet est incompatible.

## 4.7 Exemple de contrat logique

```json
{
  "tool_name": "create_payment_attempt",
  "tool_version": "1.0",
  "actor_id": "usr_123",
  "account_id": "acc_456",
  "object_id": "inv_789",
  "parameters": {
    "amount_cents": 12000,
    "currency": "EUR"
  },
  "authorization_context": {
    "permission": "payment.execute",
    "permission_status": "confirmed"
  },
  "requires_human_validation": true,
  "human_validation_id": "val_001",
  "idempotency_key": "pay_inv_789_12000_v1",
  "correlation_id": "corr_abc"
}
```

Ce schéma est illustratif. Le contrat final de chaque outil doit être défini dans son registre d’implémentation.

---

# Chapitre 5 — Contrats de sortie

## 5.1 Principe

Chaque outil doit retourner un résultat structuré.

## 5.2 États possibles

Le statut du contrat de sortie décrit **l’état de l’appel technique lui-même**, et non nécessairement l’état final de l’objet métier sous-jacent.

Le statut doit appartenir à une liste contrôlée, par exemple :

- `success` ;
- `failed` ;
- `partial` ;
- `pending` ;
- `cancelled` ;
- `unknown`.

Pour une opération asynchrone, un appel peut retourner `success` parce que la demande a bien été créée, tout en laissant l’objet métier dans un état non final tel que `créée`, `en attente` ou `en traitement`.

Le mapping détaillé entre le statut technique de l’appel et l’état métier de l’objet doit être explicité dans la fiche de chaque outil.

## 5.3 Champs minimaux

Un résultat devrait inclure :

- nom et version de l’outil ;
- identifiant de l’appel ;
- statut ;
- objet concerné ;
- résultat métier ;
- erreur éventuelle ;
- caractère réessayable ;
- horodatage ;
- identifiant externe éventuel ;
- identifiant de corrélation.

## 5.4 Exemple

```json
{
  "tool_name": "create_payment_attempt",
  "tool_version": "1.0",
  "call_id": "call_001",
  "status": "pending",
  "object_id": "inv_789",
  "result": {
    "payment_attempt_id": "pa_123",
    "provider_status": "processing"
  },
  "error": null,
  "retryable": false,
  "external_reference": "pi_123",
  "correlation_id": "corr_abc",
  "executed_at": "2026-07-23T10:00:00Z"
}
```

## 5.5 Résultat partiel

Un résultat est partiel lorsque :

- une partie de l’action a réussi ;
- certaines données manquent ;
- un sous-système n’a pas répondu ;
- une étape secondaire a échoué.

Sidian doit expliquer ce qui est confirmé et ce qui reste incertain.

## 5.6 État inconnu

L’état `unknown` doit être utilisé lorsque :

- le système ne peut pas confirmer le résultat ;
- l’appel a expiré après envoi ;
- le fournisseur a reçu la demande mais n’a pas répondu ;
- les sources se contredisent.

Un état inconnu ne doit pas déclencher automatiquement une nouvelle action susceptible de produire un doublon.

---

# Chapitre 6 — Erreurs

## 6.1 Catégories

Les erreurs doivent être distinguées en trois catégories principales.

### Erreur technique

Exemples :

- timeout ;
- indisponibilité ;
- erreur réseau ;
- réponse invalide ;
- limitation de débit.

### Erreur métier

Exemples :

- facture déjà réglée ;
- paiement déjà annulé ;
- montant incompatible ;
- état non modifiable ;
- échéance dépassée selon une règle spécifique.

### Erreur de permission

Exemples :

- acteur non autorisé ;
- compte inaccessible ;
- validation humaine absente ;
- permission expirée.

## 6.2 Comportement

Pour chaque erreur, le système doit indiquer :

- catégorie ;
- code ;
- message technique ;
- message compréhensible ;
- caractère réessayable ;
- action recommandée ;
- impact sur l’état métier.

## 6.3 Retries

Un retry est autorisé uniquement si :

- l’erreur est réessayable ;
- l’action est idempotente ou protégée ;
- le nombre de tentatives reste limité ;
- un délai est appliqué ;
- l’état n’est pas inconnu au point de risquer un doublon.

## 6.4 Limites

Sidian ne doit pas :

- répéter un appel indéfiniment ;
- modifier les paramètres au hasard ;
- contourner une permission ;
- requalifier une erreur technique en succès ;
- créer une nouvelle action lorsque l’état précédent est inconnu sans vérification préalable.

## 6.5 Transmission

Une erreur doit être transmise lorsque :

- elle concerne une action sensible ;
- les retries sont épuisés ;
- l’état métier est incertain ;
- une incohérence persiste ;
- une intervention humaine ou support est nécessaire.

---

# Chapitre 7 — Idempotence et doublons

## 7.1 Principe

Une même intention ne doit pas produire plusieurs effets involontaires.

## 7.2 Clé d’idempotence

Pour les actions compatibles, une clé d’idempotence doit être construite à partir de :

- l’action ;
- l’objet ;
- les paramètres significatifs ;
- la version ;
- la fenêtre temporelle pertinente, lorsqu’elle est nécessaire pour distinguer plusieurs intentions légitimes portant sur le même objet.

La fenêtre temporelle n’est donc pas obligatoire pour tous les outils. Elle doit être définie uniquement lorsqu’une même combinaison de paramètres peut légitimement être rejouée dans une autre période.

## 7.3 Cas concernés

Notamment :

- création de paiement ;
- remboursement ;
- envoi de message ;
- création d’échéance ;
- import de facture ;
- création d’un événement métier.

## 7.4 Vérification préalable

Avant une nouvelle exécution, le système doit vérifier :

- si une opération équivalente existe ;
- son statut ;
- si elle est terminée ;
- si elle est en cours ;
- si elle a échoué de manière sûre ;
- si son résultat est inconnu.

## 7.5 Doublon détecté

En cas de doublon :

- l’outil ne doit pas recréer l’action ;
- il retourne l’opération existante ;
- Sidian explique la situation ;
- la traçabilité est conservée.

## 7.6 Compensation

Lorsqu’une action ne peut pas être annulée directement, une action compensatoire peut être définie.

Exemples :

- remboursement après débit ;
- message correctif après envoi ;
- nouvelle écriture comptable après erreur.

Une compensation ne restaure pas nécessairement la situation initiale. Elle doit donc être traitée comme une action distincte.

---

# Chapitre 8 — Traçabilité et audit

## 8.1 Principe

Toute action significative doit pouvoir être reconstruite après coup.

## 8.2 Éléments à conserver

Le journal doit permettre de retrouver :

- qui a demandé ;
- quoi ;
- quand ;
- sur quel compte ;
- avec quelle permission ;
- avec quels paramètres ;
- quelle version d’outil ;
- quel résultat ;
- quelle erreur ;
- quelle validation humaine ;
- quelles étapes précédentes et suivantes.

## 8.3 Corrélation

Une même mission peut produire plusieurs appels.

Un `correlation_id` doit permettre de relier :

- la demande utilisateur ;
- la décision de mode ;
- les appels d’outils ;
- les événements asynchrones ;
- la réponse finale ;
- les validations humaines.

## 8.4 Données sensibles

Les logs ne doivent pas contenir inutilement :

- secrets ;
- moyens de paiement complets ;
- données personnelles excessives ;
- contenu intégral non nécessaire ;
- informations d’un autre compte.

## 8.5 Intégrité

Les journaux critiques doivent être protégés contre :

- suppression non autorisée ;
- modification silencieuse ;
- mélange entre comptes ;
- absence d’horodatage ;
- perte de corrélation.

## 8.6 Explicabilité

Sidian doit pouvoir expliquer une action sans exposer :

- secrets techniques ;
- prompt système ;
- données non autorisées ;
- raisonnement privé détaillé.

L’explication doit s’appuyer sur les faits, permissions, règles et résultats observables.

---

# Chapitre 9 — Outils asynchrones

## 9.1 Principe

Une opération asynchrone possède un cycle de vie distinct de l’appel initial.

Les états du Chapitre 5.2 décrivent le résultat technique de l’appel, tandis que les états du Chapitre 9.2 décrivent le cycle de vie métier de l’objet sous-jacent.

Ainsi :

- un appel `success` peut créer un objet métier encore `créé`, `en attente` ou `en traitement` ;
- un appel `pending` indique que le résultat technique de la demande n’est pas encore confirmé et peut correspondre à plusieurs états métier ;
- `partial` décrit un résultat technique incomplet et n’a pas nécessairement d’équivalent métier direct ;
- `expirée` est un état métier final qui doit être représenté dans le résultat détaillé, même si le statut technique de consultation est `success`.

La fiche de chaque outil asynchrone doit documenter ce mapping.

## 9.2 États métier

Le système doit distinguer au minimum :

- créée ;
- en attente ;
- en traitement ;
- réussie ;
- échouée ;
- annulée ;
- expirée ;
- inconnue.

## 9.3 Événements

Les changements d’état peuvent provenir :

- d’un webhook ;
- d’un polling ;
- d’une action humaine ;
- d’une tâche planifiée ;
- d’un système externe.

## 9.4 Webhooks

Un webhook doit être :

- authentifié ;
- validé ;
- idempotent ;
- horodaté ;
- relié à un objet connu ;
- conservé pour audit lorsque nécessaire.

## 9.5 Mise à jour

Le système ne doit pas écraser un état plus récent avec un événement ancien.

Il doit tenir compte :

- de l’ordre des événements ;
- de leur date ;
- de leur version ;
- du statut actuel ;
- des règles de transition autorisées.

## 9.6 Communication

Sidian doit différencier :

- « l’opération a été demandée » ;
- « l’opération est en cours » ;
- « l’opération est terminée » ;
- « le résultat reste inconnu ».

---

# Chapitre 10 — Orchestration multi-outils

## 10.1 Principe

Une mission peut nécessiter plusieurs outils.

L’orchestration doit rester explicite.

## 10.2 Plan d’exécution

Le plan doit préciser :

- les étapes ;
- l’ordre ;
- les dépendances ;
- les outils de lecture ;
- les outils d’écriture ;
- les validations ;
- les points d’arrêt ;
- les conditions de succès ;
- les conditions de compensation.

## 10.3 Lecture avant écriture

Lorsque nécessaire, Sidian doit lire l’état actuel avant de modifier.

Exemples :

- vérifier la facture avant paiement ;
- vérifier le statut avant retry ;
- vérifier l’autorisation avant envoi ;
- vérifier l’état d’un remboursement avant nouvelle demande.

## 10.4 Parallélisation

Des appels peuvent être parallélisés uniquement s’ils :

- sont indépendants ;
- n’altèrent pas le même état ;
- ne dépendent pas du résultat l’un de l’autre ;
- ne créent pas de risque de doublon ;
- restent traçables.

## 10.5 Échec intermédiaire

Lorsqu’une étape échoue, Sidian doit déterminer :

- si le workflow doit s’arrêter ;
- si une étape peut être réessayée ;
- si une compensation est nécessaire ;
- si les résultats partiels sont utilisables ;
- si une validation humaine est requise.

## 10.6 Transactions

Lorsque plusieurs opérations doivent être atomiques mais ne peuvent pas l’être techniquement, le système doit :

- expliciter le risque ;
- définir des contrôles ;
- prévoir une compensation ;
- conserver l’état intermédiaire ;
- éviter de présenter l’ensemble comme réussi tant que toutes les étapes ne le sont pas.

---

# Chapitre 11 — Catégories d’outils Sidian

## 11.1 Outils de consultation

Exemples :

- lire un client ;
- lire une facture ;
- consulter un paiement ;
- rechercher un événement ;
- récupérer un historique.

## 11.2 Outils de communication

Exemples :

- générer un brouillon ;
- envoyer un email ;
- envoyer une notification ;
- enregistrer une réponse ;
- planifier un message.

## 11.3 Outils financiers

Exemples :

- créer une tentative de paiement ;
- vérifier un moyen de paiement ;
- créer un remboursement ;
- consulter un litige ;
- importer un statut de paiement.

Ces outils sont sensibles.

## 11.4 Outils comptables

Exemples :

- importer une facture ;
- synchroniser un client ;
- lire un statut comptable ;
- rapprocher une écriture ;
- signaler une contradiction.

## 11.5 Outils de workflow

Exemples :

- créer une échéance ;
- suspendre une séquence ;
- reprendre une séquence ;
- annuler une action planifiée ;
- enregistrer une validation.

## 11.6 Outils de support et incident

Exemples :

- créer un ticket ;
- signaler une suspicion d’usurpation ;
- signaler une exposition de données ;
- joindre des éléments de traçabilité ;
- escalader un incident.

## 11.7 Outils interdits sans cadre spécifique

Notamment :

- exécuter du code arbitraire ;
- modifier directement des permissions ;
- accéder librement à toutes les données ;
- supprimer des traces critiques ;
- envoyer des messages sans destinataire explicite ;
- déclencher une opération financière sans objet métier identifié.

---

# Chapitre 12 — Registre d’un outil

## 12.1 Fiche obligatoire

Chaque outil de production doit posséder une fiche contenant :

- identifiant ;
- nom ;
- version ;
- description ;
- catégorie ;
- type lecture/écriture ;
- synchrone/asynchrone ;
- entrée ;
- sortie ;
- permissions ;
- niveau d’autonomie maximal ;
- validation humaine ;
- idempotence ;
- erreurs ;
- retries ;
- effets secondaires ;
- données sensibles ;
- logs ;
- propriétaire ;
- statut.

## 12.2 Exemple

```yaml
tool_id: payment.create_attempt
version: 1.0
category: financial
operation_type: write
execution_mode: asynchronous

purpose:
  create_a_payment_attempt_for_an_existing_invoice

permissions:
  required:
    - payment.execute
  scope:
    - account
    - invoice

autonomy:
  maximum_level: 3
  human_validation_required: true

idempotency:
  required: true
  key_fields:
    - invoice_id
    - amount_cents
    - currency
    - attempt_version
  time_window:
    required: false
    rationale:
      attempt_version_distinguishes_each_legitimate_new_attempt

input_contract:
  invoice_id: string
  amount_cents: integer
  currency: enum
  human_validation_id: string

output_contract:
  status: enum
  payment_attempt_id: string
  provider_status: string
  external_reference: string

errors:
  - permission_denied
  - invalid_invoice_state
  - provider_unavailable
  - duplicate_request
  - unknown_result

logging:
  correlation_id_required: true
  sensitive_fields_redacted: true
```

Ce modèle sert de référence documentaire. Son implémentation finale peut utiliser un autre format structuré.

---

# Chapitre 13 — Versionnement et cycle de vie

## 13.1 Versionnement

Chaque outil possède une version explicite.

Une modification est majeure lorsqu’elle change :

- les permissions ;
- les effets ;
- les champs obligatoires ;
- le sens d’un statut ;
- les erreurs possibles ;
- le niveau d’autonomie ;
- l’idempotence.

## 13.2 Compatibilité

Une nouvelle version ne doit pas casser silencieusement :

- les prompts ;
- les workflows ;
- les logs ;
- les évaluations ;
- les appels existants ;
- les événements asynchrones.

## 13.3 Statuts

Les statuts recommandés sont :

- Draft ;
- Review ;
- Approved ;
- Production ;
- Deprecated ;
- Disabled ;
- Archived.

## 13.4 Désactivation

Un outil peut être désactivé immédiatement en cas de :

- faille de sécurité ;
- risque de doublon ;
- mauvaise gestion des permissions ;
- corruption de données ;
- comportement contraire à la Constitution.

## 13.5 Dépréciation

La dépréciation doit préciser :

- la version concernée ;
- la raison ;
- le remplaçant ;
- la date ;
- les workflows impactés ;
- le plan de migration ;
- les évaluations nécessaires.

---

# Chapitre 14 — Application EPICU V1

## 14.1 Périmètre initial

Les premiers outils Sidian peuvent concerner :

- lecture des franchisés ;
- lecture et import des clients ;
- lecture et import des factures ;
- consultation des échéances ;
- lecture des statuts Stripe ;
- création d’une tentative de paiement autorisée ;
- suspension d’une action en cas de déclaration de paiement ;
- envoi de rappels planifiés ;
- création de brouillons ;
- journalisation des décisions ;
- transmission au support.

## 14.2 Paiement

Dans EPICU V1, Sidian doit distinguer :

- la facture ;
- l’échéance ;
- l’autorisation de paiement ;
- la tentative de paiement ;
- le résultat fournisseur ;
- l’état métier retenu par Sidian.

Une tentative de paiement ne constitue pas un paiement réussi.

## 14.3 Contradiction

Si Pennylane indique « impayée » mais que Stripe indique « paiement réussi », Sidian ne doit pas choisir silencieusement.

Il doit :

- conserver les deux sources ;
- vérifier leur fraîcheur ;
- éviter une nouvelle tentative ;
- signaler la contradiction ;
- transmettre si elle ne peut pas être résolue automatiquement.

## 14.4 Rappels

L’envoi d’un rappel planifié peut relever du Niveau 1 si :

- le workflow est autorisé ;
- le destinataire est confirmé ;
- le contenu est conforme ;
- l’envoi n’est pas suspendu ;
- aucun litige actif ne bloque la séquence.

## 14.5 Remboursements et litiges

Les remboursements, contestations et réponses à litige relèvent au minimum d’une validation humaine dans la V1.

---

# Critères globaux de validation

Le document est considéré comme opérationnel si :

1. un développeur peut implémenter un outil sans inventer de permission ;
2. un QA peut distinguer les erreurs techniques, métier et de permission ;
3. une action sensible ne peut pas être exécutée sans validation lorsqu’elle est requise ;
4. un appel peut être relié à l’acteur, la mission, la permission et le résultat ;
5. un timeout ne provoque pas automatiquement un doublon ;
6. une opération asynchrone n’est pas confondue avec un succès final ;
7. une séquence multi-outils peut être auditée ;
8. les contrats restent indépendants du LLM ;
9. aucun outil ne contourne la Constitution ou le document Prompts ;
10. les données exposées restent limitées au strict nécessaire.

---

# Scénarios minimaux à couvrir lors de la review

La review doit notamment vérifier :

- lecture autorisée d’une facture ;
- lecture refusée sur un autre compte ;
- écriture sans permission ;
- action avec validation humaine valide ;
- action avec validation expirée ;
- timeout avant réponse ;
- timeout après réception par le fournisseur ;
- retry idempotent ;
- doublon détecté ;
- résultat partiel ;
- résultat inconnu ;
- webhook reçu deux fois ;
- webhook ancien reçu après un événement récent ;
- erreur technique ;
- erreur métier ;
- erreur de permission ;
- séquence multi-outils avec échec intermédiaire ;
- action compensatoire ;
- contradiction entre Stripe et Pennylane ;
- tentative de paiement déjà existante ;
- message planifié bloqué par un litige actif ;
- tentative de modification directe des permissions ;
- fuite potentielle de données dans les logs.

---

# Journal des décisions de rédaction

| Révision | Décision | Statut |
|---|---|---|
| R1 | Séparation stricte entre décision métier et exécution technique | Acceptée sous réserve |
| R1 | Définition d’un cycle complet d’appel d’outil | Acceptée sous réserve |
| R1 | Permissions gérées par le système et non par le modèle | Acceptée sous réserve |
| R1 | Contrats d’entrée et de sortie structurés | Acceptée sous réserve |
| R1 | Distinction erreurs techniques, métier et permission | Acceptée sous réserve |
| R1 | Ajout des règles d’idempotence et de retry | Acceptée sous réserve |
| R1 | Ajout des règles pour les outils asynchrones et webhooks | Acceptée sous réserve |
| R1 | Définition de l’orchestration multi-outils | Acceptée sous réserve |
| R1 | Création d’une fiche standard par outil | Acceptée sous réserve |
| R1 | Application au périmètre EPICU V1 | Acceptée sous réserve |
| R2 | Clarification du mapping entre statuts techniques et états métier asynchrones | Acceptée |
| R2 | Clarification du caractère conditionnel de la fenêtre temporelle d’idempotence | Acceptée |
| R2 | Mise à jour de l’exemple de fiche d’outil sur l’idempotence | Acceptée |

---

# Statut de revue

- Review de conception v1.0 : **validable sous réserve**
- Correction importante : **intégrée**
- Correction mineure : **intégrée**
- Gate Review v1.1 : **oui — verrouillable**
- Dépendances vérifiées : `04_AGENT_CONSTITUTION.md`, `05_AGENT_PROMPTS.md`
- Document officiel : **verrouillé**
- Verrouillage : **oui**


---

# Note de cohérence finale

La revue croisée 04–09 n’a identifié aucune correction normative nécessaire dans ce document. Les contrats d’outils, niveaux d’autonomie, règles d’idempotence, statuts asynchrones et exigences d’audit sont repris par `08_AGENT_ARCHITECTURE` et couverts par `09_AGENT_EVALUATIONS`. Le contenu officiel reste en version 1.0 verrouillée.
