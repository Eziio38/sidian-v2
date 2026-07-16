# SIDIAN — 02 · PRODUCT REQUIREMENTS DOCUMENT (V2)
## Comment Sidian répond au problème

**Statut :** ce document répond uniquement à « comment ». Le « pourquoi » vit dans 01 (Fondations), le « avec quoi techniquement » vit dans 03 (Architecture). Lisible sans connaissances techniques. Réécrit intégralement le 14 juillet 2026.

**Légende de classification :** **[DÉCISION]** = choix produit actuel, peut évoluer. **[HYPOTHÈSE]** = à valider en bêta. **[VALIDATION RESTANTE]** = dépend d'un point tranché en 01 ou 03.

---

## 0. Incohérences de la V1 corrigées dans ce document

Avant la refonte, cinq tensions n'avaient jamais été explicitement résolues. Elles le sont ici, une fois pour toutes :

1. **Principe d'inversion du défaut vs paiement d'abord volontaire** — pas une contradiction, une séquence en deux temps assumée : le premier paiement d'un client donné reste volontaire (frictionless, via lien), l'inversion complète du défaut (prélèvement automatique) n'intervient qu'à partir du moment où ce client a accepté l'autorisation de paiement. L'inversion du défaut est l'objectif terminal, pas une condition d'entrée.
2. **Mission vs Facture vs Créance** — la **créance** est l'objet métier central (§1), visible côté produit sous le terme « paiement à recevoir ». La mission est le contexte qui la génère. La facture, quand elle existe, est une pièce justificative externe optionnelle rattachée à la créance — jamais l'objet piloté par Sidian.
3. **Paiement automatique vs paiement volontaire** — les deux coexistent par design, pas par flottement : volontaire par défaut, automatique en option construite progressivement (§4).
4. **Rôle de l'agrégation bancaire** — c'est exclusivement un mécanisme de détection et de réconciliation en lecture seule, jamais un canal d'initiation de paiement. **Hors MVP** (cf. §4.6, §8) — principe posé pour une version ultérieure, rien de construit au lancement.
5. **Rôle exact de l'agent** — deux registres d'autorité strictement distincts et non négociables (§3), pas un curseur flou d'autonomie.

---

## 1. L'objet métier central : la Créance

**[DÉCISION]** Sidian ne pilote pas des factures. Il pilote des **créances** : un montant dû par un client donné à un prestataire donné, avec une échéance, quelle que soit son origine.

Une créance peut provenir d'une facture émise ailleurs, d'un acompte convenu à la signature d'une mission, d'un échéancier négocié, d'un abonnement récurrent, ou d'une saisie/import manuel. Ce choix rend le modèle extensible sans réécriture future : le mécanisme de communication, de paiement et d'automatisation reste identique quelle que soit la source de la créance.

**Conséquence directe pour le produit :** une facture externe, quand elle existe, est une pièce jointe informative à la créance — jamais un objet que Sidian modifie, émet, ou dans lequel Sidian insère quoi que ce soit.

### Vocabulaire domaine vs vocabulaire produit

**[DÉCISION]** « Créance » est un terme de modélisation interne, précis mais qu'aucun freelance n'emploie spontanément. Il reste dans le code et la documentation technique (cf. 03). **Le terme visible par le prestataire et le client est « Paiement » ou « Paiement à recevoir »** — jamais « Facture ».

Ce choix n'est pas cosmétique : appeler l'objet « Facture » dans l'interface recréerait exactement la confusion qu'on a délibérément éliminée en distinguant Sidian d'un outil de facturation (cf. 01, §6 — Sidian n'émet pas de facture légale au MVP, par choix de périmètre, pas par impossibilité). Si le mot « Facture » apparaît partout dans le produit, un prestataire s'attendra naturellement à ce que Sidian gère la conformité fiscale, la numérotation légale, ou l'export comptable — ce que Sidian ne fait jamais. « Paiement à recevoir » décrit fidèlement ce que fait réellement l'objet, sans promesse implicite.

---

## 2. Les utilisateurs et leurs rôles

- **Le prestataire** — freelance, agence, TPE/PME. Seul mandant du produit (cf. 01, P2). Il crée des créances (directement ou via l'agent), configure des règles, et reste la seule autorité pour toute décision engageante. **Au lancement, le prestataire type est une micro-agence marketing B2B de 2 à 5 personnes** (cf. 01 §3). Sidian est utilisé principalement par son fondateur, encore responsable du suivi des règlements. **Le MVP ne propose pas encore de gestion avancée des membres, rôles et permissions** — un compte prestataire possède un utilisateur principal au lancement ; le modèle métier lui-même (le prestataire comme organisation mandante) n'en est pas affecté, seule l'interface reste mono-opérateur pour l'instant.
- **Le client (payeur)** — n'a pas de compte Sidian à proprement parler pour l'usage minimal (il peut simplement recevoir un lien et payer sans jamais « s'inscrire »). Une relation de confiance progressive se construit avec lui au fil des créances réglées.
- **L'agent** — l'acteur opérationnel qui exécute la communication et applique les règles pour le compte du prestataire (rôle détaillé en §3).

### 2bis. Onboarding prestataire — le chemin le plus court vers la première utilité

**[PRINCIPE, découle de 01 P6]** L'onboarding n'est pas une session de configuration — c'est le chemin le plus court vers la création du premier paiement à recevoir. Toute étape qui demande un jugement sur une situation hypothétique (ton par défaut, seuils de fermeté, règles par client) est reportée après l'onboarding, au moment où une vraie situation la justifie (cf. §3 — configuration conversationnelle contextuelle).

**Séquence cible :**
1. Inscription (email, mot de passe).
2. Choix du profil agent — « je garde le contrôle total » ou « je délègue au maximum » (cf. §3) — un clic, pas un questionnaire.
3. Création minimale du compte Stripe Connect (email, type d'activité) — cf. §4.2, nécessaire pour que le lien de paiement soit disponible dès le premier paiement à recevoir créé.
4. Ajout du premier client (nom, email).
5. Création du premier paiement à recevoir (montant, échéance).

**L'onboarding Stripe complet** (vérification d'identité, IBAN — `charges_enabled = true`) est reporté au moment du premier envoi réel du lien ou de la première tentative de paiement, jamais imposé avant (cf. §4.2).

**Aucune configuration de règle par client, aucun réglage de ton fin, aucune connexion Pennylane n'est demandée à ce stade** — tout ça reste accessible mais jamais requis pour créer le premier paiement à recevoir.

---

## 3. Le rôle de l'agent

**[DÉCISION FONDATRICE — découle de 01, P3]** L'agent fonctionne comme un concierge : autorité large sur la communication, bornée strictement sur l'argent et l'engagement.

### Registre libre (autonomie totale, aucune validation requise)
Toute communication informative : notices avant échéance, rappels, réponses aux questions du client, dialogue de clarification, détection de signaux (tension, désaccord, silence prolongé).

### Registre encadré (autonomie bornée par des règles pré-configurées, jamais improvisée)
Tout ce qui touche à l'argent ou à l'engagement : proposer un délai, proposer un étalement, durcir le ton au-delà d'un plafond défini, engager une action qui ressemble, de près ou de loin, à une étape contentieuse.

**Règles non négociables du registre encadré, quelle que soit la configuration du prestataire :**
- Jamais de réduction de montant dû.
- Jamais de déclenchement autonome d'une action formelle (mise en demeure, procédure, transmission à un tiers) — validation explicite du prestataire systématiquement requise.
- Escalade systématique vers le prestataire dès qu'un signal de litige réel est détecté, plutôt que tentative de résolution autonome.
- Aucun wording qui pourrait se requalifier en menace informelle, même au plafond de fermeté le plus élevé configuré.

### Configuration des règles

**[DÉCISION]** Les règles par défaut sont sûres dès le premier jour ; le prestataire les ajuste en langage naturel, globalement ou créance par créance / client par client, en conversation directe avec l'agent (ex. « sois plus souple avec Marie »).

**Règle non négociable d'implémentation produit :** chaque changement de règle est reformulé en clair par l'agent, avec ses conséquences concrètes, et confirmé explicitement avant application. Aucune interprétation silencieuse d'une instruction ambiguë.

Deux profils de démarrage **[HYPOTHÈSE — à valider par l'usage réel]** : « je garde le contrôle total » et « je délègue au maximum », pour éviter une configuration paramètre par paramètre dès le premier jour.

---

## 4. Le parcours utilisateur — vue produit (sans détail d'implémentation)

### 4.1 Avant échéance
Confirmation légère à la création de la créance (montant, échéance, ton neutre). Rappel informatif quelques jours avant échéance — jamais une demande, une information. C'est le meilleur moment pour qu'un vrai problème remonte de lui-même, puisqu'on ne demande rien.

### 4.2 À échéance
Si rien n'est réglé : l'agent présume l'oubli, jamais la mauvaise foi. Un lien de paiement est envoyé directement par l'agent au client, indépendamment de tout outil de facturation tiers.

**[DÉCISION]** Le lien de paiement existe et reste accessible dès la création du paiement à recevoir, pas seulement à l'échéance — ce que le calendrier de communication du §4.1 déclenche, c'est l'envoi *actif* par l'agent selon les règles configurées, jamais la disponibilité elle-même. Rien n'empêche un client volontaire de régler avant même d'avoir reçu la moindre notice, si le prestataire lui a partagé le lien plus tôt.

**Conséquence sur l'onboarding prestataire, pour ne pas contredire cette décision :** un lien de paiement en direct charge suppose qu'un compte Stripe Connect existe déjà côté prestataire. Pour que le lien soit réellement disponible dès la création du premier paiement à recevoir, sans pour autant forcer l'utilisateur à traverser tout l'onboarding Stripe (vérification d'identité, IBAN) avant d'avoir vu la moindre valeur du produit, l'onboarding prestataire distingue deux moments :
1. **Création minimale du compte Connect** (email, type d'activité) — rapide, positionnée tôt dans l'onboarding, avant même la création du premier client.
2. **Onboarding Stripe complet** (`charges_enabled = true`) — reporté au moment du premier envoi réel du lien ou de la première tentative de paiement, jamais imposé avant.

**[FAIT CONFIRMÉ, avec un point de mesure restant]** Stripe documente officiellement ce découpage sous le nom d'« onboarding incrémental » (`collection_options.future_requirements`) : un compte connecté peut être créé avec un minimum d'informations suffisant pour activer les paiements, le reste des exigences (notamment la vérification documentaire poussée) étant reporté à plus tard. Ce n'est donc pas une hypothèse de conception mais un pattern prévu par Stripe pour ce cas d'usage exact. **Ce qui reste à mesurer, pas à supposer :** le minimum incompressible d'informations exigé pour la France (probablement au moins l'identité basique du représentant — nom, date de naissance, adresse) varie selon le type d'activité et l'évaluation de risque de Stripe, et peut évoluer indépendamment de notre code — à vérifier contre l'API réelle au moment de l'implémentation, pas à figer ici comme une durée ou une liste de champs précise.

### 4.3 Le choix du moyen de paiement — carte et SEPA proposés dès le premier règlement

**[DÉCISION]** Le lien de paiement Sidian permet au client de choisir entre les moyens de paiement activés et compatibles avec la créance — au minimum la carte bancaire et le prélèvement SEPA Core lorsque ces moyens sont disponibles. **Sidian peut recommander une méthode selon le montant, le pays, la devise, l'historique et les autorisations déjà actives, mais ne décide jamais à la place du client et ne masque ni ne désactive jamais un moyen sur la seule base d'un seuil de montant estimé.**

**Pourquoi pas d'arbitrage automatique par seuil (correction d'une décision V1) :** un plafond de carte n'est jamais connu à l'avance de façon fiable — il dépend de la banque, du type de carte (pro, virtuelle, plafond temporairement augmenté) et du titulaire. La bonne pratique n'est pas de deviner avant la tentative, mais de laisser la tentative elle-même révéler si le paiement passe. Concrètement : pour un montant élevé, Sidian peut afficher une recommandation discrète en faveur du SEPA (« pour ce montant, le prélèvement bancaire peut éviter les limites éventuelles de votre carte »), sans jamais retirer l'option carte.

**Ordre d'affichage, contextuel plutôt que fixe [HYPOTHÈSE — logique de départ à affiner en bêta] :**
- Montant faible à moyen : carte affichée en premier (parcours familier, confirmation rapide), SEPA en second.
- Montant élevé : les deux options au même niveau, avec la recommandation discrète en faveur du SEPA mentionnée ci-dessus.
- Client ayant déjà une autorisation active avec ce prestataire (cf. §4.4) : le moyen déjà autorisé apparaît en premier, avec toujours la possibilité d'en utiliser un autre.

**Ce que chaque rail implique, à faire connaître au client si besoin (pas nécessairement affiché en permanence) :** la carte offre une confirmation généralement rapide mais reste soumise aux plafonds et à l'authentification bancaire ; le SEPA convient mieux aux montants élevés et à la récurrence mais implique un règlement différé (délai de plusieurs jours ouvrés avant confirmation définitive), une notification obligatoire avant chaque débit, et un droit à remboursement du client sans justification pendant 8 semaines dans le cadre du mandat SEPA Core — un rail n'est jamais présenté comme universellement supérieur à l'autre.

### 4.4 Le paiement et la proposition d'automatisation

Le client règle via l'un des deux moyens proposés. **Immédiatement après ce paiement**, une proposition unique s'affiche : autoriser les futurs règlements avec ce même prestataire.

**[DÉCISION]** La proposition présélectionne le moyen que le client vient d'utiliser, mais permet toujours d'en choisir un autre — le moyen du premier paiement ne détermine jamais irrévocablement le moyen des règlements automatiques futurs. Concrètement : un client qui vient de payer par carte peut choisir d'automatiser plutôt via un compte bancaire, et inversement.

**Sur la question de savoir s'il faut orienter par défaut vers le compte bancaire dès que la récurrence est activée** — la réponse retenue est nuancée plutôt que tranchée par une règle rigide : il existe une vraie raison technique de recommander le SEPA pour la récurrence (les mandats sont conçus pour la réutilisation et ne connaissent pas les frictions d'authentification renforcée ou d'expiration propres à la carte), mais ce n'est qu'une recommandation informative, jamais un choix imposé au client — exactement le même principe que pour le premier paiement (§4.3). Sidian peut donc afficher, au moment de la proposition d'automatisation, une mention du type « pour des paiements récurrents, un compte bancaire est souvent plus stable dans la durée (pas d'expiration de carte) » — sans présélectionner autre chose que le moyen réellement utilisé au dernier paiement.

**Cas de figure :**
- Acceptée → les futures créances éligibles avec ce prestataire peuvent être réglées automatiquement, **sous réserve** : d'une autorisation active, d'une créance non contestée, et d'un moyen de paiement toujours utilisable au moment de l'échéance. Ce n'est jamais une garantie absolue — un paiement automatique peut échouer (provision insuffisante, carte expirée, authentification requise), auquel cas la créance repasse en flux de lien manuel (cf. 03, machine d'état « tentative de paiement »).
- Refusée → le lien continue d'être envoyé à chaque échéance ; une option discrète et permanente reste disponible sur l'écran de paiement pour changer d'avis à l'initiative du client, sans nouvelle sollicitation active.
- **[HYPOTHÈSE]** Après un nombre de paiements réguliers sans incident (valeur de départ : 3 à 4, à calibrer en bêta), cette option redevient légèrement plus visible, jamais sous forme d'un nouveau popup insistant.

### 4.5 Après échéance sans paiement
Fermeté progressive mais toujours factuelle (cf. 01, P4). Une fenêtre de dialogue reste ouverte à tout moment pour canaliser un vrai désaccord vers un échange humain avant que la situation ne s'aggrave.

### 4.6 Détection hors-Sidian — hors MVP, principe posé pour plus tard

**[DÉCISION]** Un client peut toujours régler en dehors du lien Sidian (virement classique). **Ce cas n'est pas couvert au MVP** (cf. §8) — le tableau de bord ne reflète que ce qui transite par Sidian, et un tel virement passe simplement inaperçu du produit au lancement. Le principe retenu pour une version ultérieure, documenté ici pour ne pas fermer la porte : une connexion en lecture seule du compte bancaire du prestataire rapprocherait les virements entrants avec les créances ouvertes par montant et référence, sans jamais générer de commission sur ces règlements (cf. §6), uniquement pour garder le tableau de bord fiable.

**Exigences de transparence déjà posées pour le jour où cette brique sera construite, non négociables :**
- Jamais proposée à l'inscription ni en obligation précoce.
- Le pourquoi énoncé en une phrase claire, sans jargon.
- Le mot « lecture seule » explicite et permanent.
- Le prestataire technique nommé, jamais présenté comme un stockage d'identifiants par Sidian.
- Visible et réversible en un clic à tout moment.
- Cadrage centré sur le bénéfice du prestataire (fiabilité du tableau de bord), jamais sur la fonction de détection de contournement.

---

## 5. Rôle des systèmes tiers — niveau produit

| Système | Rôle | Dépendance |
|---|---|---|
| Outil de facturation du prestataire | Émet le document légal, complètement découplé de Sidian | Jamais bloquant pour le mécanisme de base ; intégration future = accélérateur, pas prérequis |
| Infrastructure de paiement (Stripe) | Exécute les paiements ponctuels et, lorsqu'une autorisation de paiement future active existe, les tentatives automatiques éligibles par carte enregistrée ou prélèvement SEPA Core | Cœur technique — détail en 03 |
| Agrégation bancaire | Détection en lecture seule des paiements hors Sidian | **Hors MVP** (cf. §8) — principe posé pour une version ultérieure, filet de sécurité indépendant de tout éditeur tiers le jour où il sera construit |

---

## 6. Modèle économique

### Pricing de lancement — Sidian Early Access

**[DÉCISION COMMERCIALE TEMPORAIRE]** La structure Starter/Pro/Business à commission 5 %/2 %/0 % n'est plus le pricing actif pour les nouveaux bêta-testeurs. Une seule offre :

**Sidian Early Access — 49 € HT par mois**

Inclus : suivi des paiements à recevoir, agent de communication et de relance, liens de paiement par carte et SEPA Core lorsqu'ils sont disponibles et compatibles, proposition d'autorisation de paiement future au client, tableau de bord, onboarding accompagné, accès à la connexion Pennylane lorsqu'elle sera disponible (sans que celle-ci constitue une condition de lancement du MVP, cf. §8).

Conditions : sans engagement ; garantie satisfait ou remboursé pendant 30 jours ; limité aux 20 premiers comptes ; prix maintenu 12 mois pour ces premiers utilisateurs ; aucun plan gratuit.

### Commission pendant la bêta

**[DÉCISION COMMERCIALE TEMPORAIRE]** La commission Sidian est fixée à **0 %** pendant la bêta. Les frais techniques du prestataire de paiement restent distincts du prix de l'abonnement et sont supportés selon l'architecture de paiement retenue et les conditions applicables au compte du prestataire — **aucun montant précis de frais Stripe n'est promis ici**, ces frais dépendent du rail utilisé, du volume et des conditions du compte.

**Raison de cette décision :** la suppression temporaire de la commission permet de tester une question unique — *une micro-agence accepte-t-elle de payer chaque mois pour déléguer le suivi de ses règlements ?* Elle évite pendant la bêta un prix difficile à expliquer, une incitation à contourner les liens Sidian, une confusion entre la valeur du produit et un paiement uniquement au succès, et une dépendance prématurée au volume financier encaissé. Ça ne signifie pas qu'une commission future est exclue — seulement qu'elle n'est pas testée pendant l'Early Access.

### Hypothèse de pricing après validation

**[HYPOTHÈSE — non engagée commercialement, à ne jamais présenter aux bêta-testeurs comme un engagement futur]**

Une fois Sidian arrivé à environ 20-30 entreprises payantes, les paiements carte et SEPA stabilisés, et les fonctions équipe essentielles développées, la structure suivante pourra être testée :

| Offre | Prix envisagé | Limite principale |
|---|---|---|
| Solo | 69 € HT/mois | 10 clients actifs |
| Studio | 149 € HT/mois | 30 clients actifs et 3 utilisateurs |
| Agence | 349 € HT/mois | 100 clients actifs et automatisations avancées |

Cette grille sera recalibrée à partir des usages réels, des coûts, de la disposition à payer observée et des entretiens clients. **Les futurs critères de tarification privilégiés sont le nombre de clients suivis, le nombre de paiements à recevoir actifs, le nombre d'utilisateurs, le niveau d'automatisation et les fonctions de reporting — le chiffre d'affaires encaissé n'est pas prévu comme axe tarifaire principal**, contrairement à la logique de commission proportionnelle de la V1. *(Principe conservé pour toute commission future, si elle est un jour réintroduite : elle ne serait due que sur une créance réglée via le lien envoyé par l'agent, jamais sur un règlement détecté a posteriori hors Sidian, cf. §4.6.)*

---

## 7. KPI produit à suivre dès la bêta

**[HYPOTHÈSE — liste de départ, à affiner]**
- Taux d'acceptation de l'autorisation de paiement automatique au premier paiement, et à la re-proposition différée.
- Délai moyen entre échéance et paiement, par branche causale observée (oubli/process, tension trésorerie, litige, stratégique).
- Taux d'ouverture de la fenêtre « signaler un problème » et son taux de résolution sans escalade.
- Fréquence et nature des ajustements de règles par conversation (pour calibrer les profils par défaut).
- Taux d'échec de tentative de paiement par tranche de montant et par rail (carte vs SEPA).
- *(Le taux de paiement via lien Sidian vs paiement détecté hors Sidian ne devient mesurable qu'une fois l'agrégation bancaire construite, cf. §4.6 — absent du MVP.)*

### Objectif commercial de validation

**[DÉCISION]** Au-delà des KPI produit, la bêta doit répondre à une question commerciale précise :
- obtenir 20 micro-agences ou entreprises réellement payantes ;
- suivre de vrais paiements à recevoir ;
- mesurer la diminution du nombre de relances manuelles réalisées par le fondateur ;
- mesurer l'évolution du délai moyen de règlement ;
- vérifier la rétention après les premières semaines d'utilisation ;
- vérifier que 49 € par mois est accepté pour la valeur du produit, indépendamment d'une commission au succès.

**Les inscriptions gratuites, listes d'attente et comptes inactifs ne comptent pas comme validation.**

---

## 7bis. Assistants externes (Claude, ChatGPT) — note de cadrage

**[DÉCISION]** La logique métier de Sidian ne dépend d'aucun fournisseur d'intelligence artificielle, aujourd'hui comme demain (cf. 01, P9/P10). Concrètement, ça veut dire que si un usage réel via Claude ou ChatGPT est un jour confirmé par des utilisateurs, l'intégration se fera comme un simple adaptateur vers les fonctions déjà existantes — jamais comme une réécriture de la logique produit. **Aucune intégration externe (MCP ou autre) n'est développée avant qu'un besoin utilisateur réel ne le justifie** ; le détail technique de cette anticipation est traité en 03 §11. Ce sujet n'a aucune conséquence sur le périmètre ou le calendrier du MVP ci-dessous.

---

## 8. Périmètre du MVP

**[DÉCISION]** Le MVP tient en cinq blocs, pas un de plus. Toute fonctionnalité qui n'apparaît pas ci-dessous est hors MVP, sans exception ni « ça pourrait rentrer si… ».

1. **Création de créance manuelle** (aucune intégration facturation tierce au MVP).
2. **Communication par email** (notice avant échéance, relance, fenêtre de dialogue) — SMS et WhatsApp hors MVP.
3. **Paiement Stripe** : lien carte + SEPA Core, capture de commission *(mécanisme technique conservé, configuré à 0 % pendant l'Early Access, cf. §6)* et proposition d'autorisation de paiement future après le premier règlement.
4. **Dashboard** (état résumé + liste des paiements à recevoir).
5. **Agent IA** (`runAI`, intentions structurées, garde-fous, registre libre/encadré).

**Explicitement hors MVP, sans ambiguïté :**
- Intégration profonde avec un outil de facturation tiers (Pennylane ou autre) — **la connexion Pennylane peut être incluse commercialement dès sa disponibilité pour les membres Early Access (cf. §6), mais elle reste hors des cinq blocs techniques stricts du MVP initial.**
- Agrégation bancaire / détection de paiement hors Sidian — **conséquence assumée** : au MVP, un client qui paie par virement classique en dehors du lien Sidian n'est détecté par aucun mécanisme automatique ; le tableau de bord de trésorerie ne reflète que ce qui transite par Sidian. Ce risque est accepté pour la durée du MVP, pas résolu.
- Signal de risque client à la création de créance (scoring externe).
- Étalement automatique proposé sur échec de prélèvement.
- Statut PDP / interopérabilité facturation électronique.
- SMS, WhatsApp, tout canal hors email.
- **Rôles équipe, gestion multi-utilisateurs, reporting avancé, fonctionnalités spécifiques aux grands comptes** — cohérent avec la cible de lancement mono-opérateur (cf. §2, 01 §3).

Cette liste peut être discutée à nouveau — mais seulement sur la base d'un signal réel issu de la bêta ou du développement, jamais par anticipation.

---

*Document 02 sur 3 — V2. Voir 01 · Fondations et 03 · Architecture technique.*
