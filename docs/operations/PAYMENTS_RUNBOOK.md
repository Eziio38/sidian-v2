# Sidian — Runbook paiements

> Guide opérationnel pour diagnostiquer et réconcilier les paiements.
> Source de vérité métier : [`SIDIAN_02_PRD_V2.md`](../SIDIAN_02_PRD_V2.md) et [`SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`](../SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md)
> Checklist déploiement : [`PRE_DEPLOYMENT_CHECKLIST.md`](./PRE_DEPLOYMENT_CHECKLIST.md)
>
> **Ce fichier remplace entièrement la version antérieure**, construite autour de `mission_status`, d'une séquence figée J0/J5/J9/J10 et d'un enrôlement carte obligatoire — modèle abandonné le 14 juillet 2026. Voir `AGENTS.md` pour le contexte du changement.

---

## 1. Architecture résumée

```
Paiement à recevoir créé (créance OUVERTE)
        ↓
  [Fenêtre préventive configurée, valeur initiale proposée : J-5]  →  notice informative, jamais de demande
        ↓
  [Échéance]  →  lien de paiement envoyé activement par l'agent
        ↓
  Client règle (carte ou SEPA Core, choix libre) via le lien
        ↓
  Webhook Stripe (tentative_paiement → RÉUSSIE) → paiement créé → créance RÉGLÉE (ou PARTIELLEMENT_RÉGLÉE)
        ↓
  Popup unique : proposition d'autorisation de paiement future
        ↓
  [Si acceptée] → paiements à recevoir suivants du même client × prestataire en prélèvement automatique (registre encadré)
```

**Principes :**
- **Objet central = paiement à recevoir** (`creance` en base), jamais une facture Sidian — la facture légale, si elle existe, est émise ailleurs et n'est qu'une référence informative (`reference_externe`).
- **Premier règlement toujours volontaire** — aucun enrôlement, aucune carte enregistrée n'est jamais exigée avant un premier paiement.
- **Quatre machines d'état séparées et jamais mélangées** : créance (état financier), tentative de paiement (un essai), autorisation de paiement (le mandat/la carte enregistrée), dossier de suivi (le fil relationnel). Un échec de carte ne doit **jamais** dégrader l'état financier affiché de la créance.
- **Direct charge** uniquement — fonds sur le compte Connect du prestataire, commission via `application_fee_amount`.
- **Commission = 0 % pendant l'Early Access** (`platform_fee_basis_points = 0`) — jamais une commission positive codée en dur par plan.
- **Aucune commission sur un paiement détecté hors Sidian** (hors MVP de toute façon, cf. §7).

---

## 2. Les quatre machines d'état

### Créance (`creance.etat`)
`BROUILLON` → `OUVERTE` → (`PARTIELLEMENT_RÉGLÉE` →) `RÉGLÉE` | `EN_LITIGE` | `ANNULÉE` | `IRRÉCOUVRABLE`

### Tentative de paiement (`tentative_paiement.etat`)
`CRÉÉE` → `NÉCESSITE_ACTION_CLIENT` | `EN_TRAITEMENT` → `RÉUSSIE` | `ÉCHOUÉE` | `ANNULÉE`

**Règle non négociable :** une tentative ne passe à `RÉUSSIE` que sur réception d'un événement fiable de Stripe (webhook), jamais par écoulement d'un délai — en particulier pour le SEPA, où `EN_TRAITEMENT` peut durer plusieurs jours ouvrés sans que ça signifie un échec.

### Autorisation de paiement (`payment_authorization.etat`)
`NON_PROPOSÉE` → `PROPOSÉE` → `EN_CONFIGURATION` → `ACTIVE` | `REFUSÉE` ; puis `ACTIVE` → `SUSPENDUE` | `RÉVOQUÉE` | `EXPIRÉE`

Deux types : `card_off_session` et `sepa_core_mandate`. Une seule autorisation `is_default = true` par couple client × prestataire à la fois ; plusieurs autorisations peuvent coexister à `ACTIVE` (moyen de secours), mais seule celle par défaut est utilisée au MVP.

### Dossier de suivi (`dossier_suivi.etat`)
`PRÉVENTION` → `ÉCHÉANCE` → `SUIVI_AMIABLE` → (`PAUSE_LITIGE` | `ATTENTE_CLIENT` | `ATTENTE_PRESTATAIRE` →) `ESCALADE_HUMAINE` → `CLOS`

**Aucun de ces quatre états ne doit jamais être déduit d'un autre.** Un dossier de suivi en `ESCALADE_HUMAINE` n'implique rien sur l'état financier de la créance — elles peuvent être réglées indépendamment.

---

## 3. Rôle des tables (MVP)

| Table | Rôle |
|---|---|
| `prestataire` | Compte, `subscription_status`, `pricing_version`, `platform_fee_basis_points` |
| `client_payeur` | Le payeur, rattaché à un prestataire |
| `creance` | Le paiement à recevoir — entité pivot |
| `tentative_paiement` | Chaque essai, y compris échoué — jamais dans `paiement` |
| `paiement` | Règlements confirmés uniquement |
| `payment_authorization` | Carte enregistrée ou mandat SEPA, généralisés |
| `dossier_suivi` | Le fil relationnel, un par créance |
| `regle` | Règles par défaut ou par client, configurables en langage naturel |
| `conversation` / `message` | Trace immuable, valeur probatoire |
| `approval_request` | Demandes d'approbation créées par le registre encadré |
| `audit_log` | Trace systématique de toute action du registre encadré |
| `processed_webhook_event` | Déduplication des webhooks Stripe |
| `stripe_webhook_effect` | Unicité transactionnelle des effets Stripe |
| `stripe_customer_binding` | Customer Stripe scopé par prestataire/client |
| `payment_link` | URL opaque active/révoquée |
| `stripe_connect_audit_outbox` | Audit Connect durable et récupérable |

---

## 4. Communication et automatisation

**Pas de calendrier universel figé.** Le rythme dépend des règles configurées par le prestataire (globales ou par client) et du cycle propre à chaque créance :

| Moment | Action | Destinataire |
|---|---|---|
| Fenêtre préventive (valeur par défaut proposée : J-5, configurable) | Notice informative — jamais une demande | Client |
| Échéance atteinte | Lien de paiement envoyé activement | Client |
| Silence prolongé | Ton plus ferme, toujours factuel | Client |
| Plafond configuré atteint | Escalade humaine — jamais d'action formelle automatique | Prestataire |

**Automatisation :** une fois une `payment_authorization` à `ACTIVE`/`is_default = true`, les paiements à recevoir suivants du même client × prestataire peuvent être réglés par tentative automatique — jamais présentée comme garantie. Un échec repasse en flux de lien manuel + notification prestataire.

---

## 5. Webhooks

**Endpoint Connect :** `POST /api/stripe/webhook`
**Secret :** `STRIPE_CONNECT_WEBHOOK_SECRET`

Événements minimum à traiter : tentative réussie, tentative échouée, authentification requise, autorisation créée/révoquée, dispute ouverte.

Chaque événement :
1. Vérification signature.
2. `event.account` = compte connecté attendu.
3. Claim atomique avec token de lease et tentative ; toute transition/extension exige les deux.
4. Erreur classée `retryable`, `terminal` ou `lease_lost`, avec 8 tentatives maximum.
5. Effet métier transactionnel/idempotent ; `account.updated` relit toujours Stripe live et vérifie le fencing du claim avant toute écriture. La projection peut être rafraîchie sous le claim courant même si le registre d'effet existe ; ne pas reprendre cette règle pour un effet financier.
6. Mise à jour de la `tentative_paiement`, puis création idempotente du `paiement` si `RÉUSSIE`, puis recalcul de l'état de la `creance` (**SID-STRIPE-002-B, chemin paiement implémenté**). Effets financiers fencés par le lease du claim et le registre `stripe_webhook_effect` (appliqués au plus une fois), tolérants au désordre et aux doublons d'arrivée. Trop-perçu : créance `RÉGLÉE` + `audit_log` + `approval_request(depassement_seuil)` — jamais de perte de fonds ni d'état improvisé. Le chemin **autorisation future** (`setup_intent.*`, `mandate.updated`, `payment_method.detached`, branche `setup` des sessions Checkout) reste différé à un lot ultérieur et est explicitement ignoré (`deferred_to_authorization_lot`).

---

## 6. Diagnostiquer un paiement à recevoir

1. **Supabase** → table `creance` → `id`, `etat`, `montant`, `date_echeance`.
2. **Tentatives** → `tentative_paiement` WHERE `creance_id` = X ORDER BY `created_at` — vérifier qu'aucune n'est restée `EN_TRAITEMENT` anormalement longtemps (SEPA : plusieurs jours ouvrés attendus).
3. **Règlements confirmés** → `paiement` WHERE `creance_id` = X — vérifier la somme vs le montant de la créance pour un règlement partiel.
4. **Dossier de suivi** → `dossier_suivi` WHERE `creance_id` = X → état relationnel, indépendant du financier.
5. **Autorisation** → `payment_authorization` WHERE `client_payeur_id` + `prestataire_id` correspondants, `is_default = true`.
6. **Webhooks** → `processed_webhook_event` + logs applicatifs filtrés par `creance_id` ou `payment_intent`.
7. **Stripe Dashboard** → mode test → compte Connect du prestataire → PaymentIntents.

### Questions clés
- Y a-t-il une `tentative_paiement` à `RÉUSSIE` ? Correspond-elle à une ligne `paiement` ?
- L'état de la créance reflète-t-il correctement la somme des `paiement` confirmés ?
- Le `dossier_suivi` est-il cohérent avec l'historique de `conversation`/`message` ?
- `platform_fee_basis_points` du prestataire est-il bien à 0 (Early Access) ?

---

## 7. Paiement hors Sidian (hors MVP)

**Aucune agrégation bancaire n'est développée au MVP.** Un virement classique en dehors du lien Sidian n'est détecté par aucun mécanisme automatique — le tableau de bord ne reflète que ce qui transite par Sidian. Si cette possibilité est retenue côté produit, seule une transition manuelle de la créance vers `RÉGLÉE` à l'initiative du prestataire existe, sans détection automatique ni commission associée.

---

## 8. Réconcilier un webhook manqué

1. Stripe Dashboard → Developers → Events → retrouver l'événement.
2. Vérifier `event.account` = compte connecté attendu.
3. **Replay** depuis Stripe (ou `stripe events resend`).
4. Vérifier `processed_webhook_event` et `stripe_webhook_effect` — acquisition terminale et effet métier sont deux garanties distinctes.
5. Si écart persistant : correction manuelle **uniquement** via SQL service role documenté (dernier recours).

---

## 9. Paiement bloqué

| Symptôme | Cause probable | Action |
|---|---|---|
| Tentative automatique non créée à échéance malgré une autorisation active | Worker « Scanner de paiements automatiques » n'a pas tourné | Vérifier le cron |
| `NÉCESSITE_ACTION_CLIENT` prolongé | Authentification (3DS) non complétée | Le client doit authentifier via le lien |
| `EN_TRAITEMENT` prolongé (SEPA) | Normal jusqu'à plusieurs jours ouvrés | Ne pas traiter comme un échec avant confirmation Stripe |
| `ÉCHOUÉE` répétée | Provision insuffisante, carte expirée, refus banque | Selon la politique de retry en vigueur (§10) — par défaut au MVP, repasse en flux de lien manuel |
| Litige ouvert | Dispute Stripe | `dossier_suivi` → `PAUSE_LITIGE`, pas de remboursement automatique |

---

## 10. Politique de retry

**Aucun calendrier figé au MVP** — comportement par défaut : `retry_policy = none`, une tentative échouée repasse immédiatement en flux de lien manuel avec notification au prestataire. Une politique plus élaborée dépendra, une fois développée, du rail, du code d'échec, du besoin d'authentification et de la présence d'un litige — jamais d'un nombre de tentatives arbitraire codé en dur.

---

## 11. Remboursements et litiges

- **Remboursement :** action explicite du prestataire, jamais automatique. Commission remboursée intégralement si applicable (non pertinent pendant l'Early Access, commission = 0 %).
- **Litige (`dispute_status` sur la tentative/le paiement concerné) :** ne modifie jamais directement l'état de la créance — fait transitionner le `dossier_suivi` vers `PAUSE_LITIGE`. Pas de logique comptable automatique en cas de litige perdu.

---

## 12. Rollback d'urgence

1. Poser `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=false` puis redéployer. Le flag est obligatoire et fail-closed.
2. Mettre en pause les workers (§4, cf. 03 §7) — en particulier le Scanner de paiements automatiques.
3. Le webhook Sidian répond alors immédiatement `404` sans lire ni persister l'événement. Stripe retentera : surveiller le backlog avant toute réactivation.
4. Garder l'endpoint configuré dans Stripe ; ne pas supprimer sa destination ni son secret.
5. Redéployer la version stable, réactiver seulement après diagnostic, puis résorber les retries Stripe.
6. Voir la checklist de déploiement pour la procédure complète.

## 13. JWT Customer binding writer

`SUPABASE_STRIPE_BINDING_WRITER_JWT` est un JWT serveur pré-généré, jamais une clé privée. Il porte au minimum `role=stripe_customer_binding_writer`, `sidian_environment=local|staging|production` et une expiration bornée. Le JWT, la clé publishable/anon et l'URL doivent provenir du même projet Supabase.

Procédure manuelle, à exécuter hors logs et hors CI bavarde :

1. Utiliser la clé de signature contrôlée du projet Supabase de l'environnement concerné ; ne jamais copier la clé privée dans Vercel.
2. Générer le bearer avec `supabase gen bearer-jwt --role stripe_customer_binding_writer --valid-for <durée-bornée> --payload '{"sidian_environment":"<environnement>"}'`.
3. Poser uniquement le JWT résultant dans la variable Vercel sensible de l'environnement correspondant, puis redéployer.
4. Valider un binding et les refus `service_role` avant de retirer l'ancien déploiement.
5. Pour la rotation, générer un nouveau JWT, mettre à jour Vercel, redéployer et vérifier avant l'expiration de l'ancien. En cas de compromission, révoquer/faire tourner la signing key Supabase selon le runbook du projet et redéployer tous les consommateurs.

Local, staging et production utilisent des projets/signing keys distincts. Un JWT staging ne doit jamais être copié dans les variables production.

---

## 14. Commandes utiles

**⚠️ Ces commandes reprennent des conventions de l'ancien projet — à vérifier une par une au fil de l'implémentation ; si le script ou la commande n'existe pas encore dans le nouveau repo, le créer plutôt que de supposer qu'il existe.**

```bash
# Vérifier migrations — à créer pendant l'implémentation si absent
node scripts/verify-migrations-order.mjs

# Tests
pnpm test
pnpm typecheck

# Écouter webhooks Connect en local
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook

# Build
pnpm build
```

---

*Réécrit le 14 juillet 2026 suite au changement de modèle produit — remplace la version construite autour de `mission_status` et de la séquence J0/J5/J9/J10.*
