# Validation Stripe — mode test

> Plan E2E pré-production. **Ne pas marquer comme terminé sans preuve.**
> Référence : [`SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`](../SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md)
>
> **Ce fichier remplace entièrement la version antérieure**, dont les 10 scénarios étaient calés sur l'ancienne séquence (enrôlement obligatoire, confirmation freelance à J+9, direct charge à J+10). Modèle abandonné le 14 juillet 2026 — voir `AGENTS.md`.

**Statut global : [ ] NON EXÉCUTÉ** — à mettre à jour au fil de l'implémentation Phase 3 (cf. 03 §10, plan Cursor).

---

## Prérequis communs

| Prérequis | Statut | Note |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=true` | [ ] | Activation explicite |
| `SIDIAN_ENVIRONMENT=local` et `STRIPE_MODE=test` | [ ] | Aucun fallback implicite |
| `STRIPE_SECRET_KEY=sk_test_*` | [ ] | |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_*` | [ ] | |
| `STRIPE_CONNECT_WEBHOOK_SECRET` configuré | [ ] | Bloque tous les scénarios webhook si absent |
| `SUPABASE_STRIPE_BINDING_WRITER_JWT` local valide | [ ] | Rôle writer + `sidian_environment=local`, aucune clé privée dans l'app |
| Migrations MVP appliquées (17 tables, dont 4 registres techniques Stripe) | [ ] | |
| Compte prestataire avec Connect onboardé (`charges_enabled=true`) | [ ] | Onboarding hébergé humain requis |
| Stripe CLI | [ ] | `brew install stripe/stripe-cli/stripe` |
| App Next démarrée | [ ] | |

### Cartes de test utiles

| Carte | Comportement |
|---|---|
| `4242 4242 4242 4242` | Succès |
| `4000 0025 0000 3155` | 3DS / authentication_required |
| `4000 0000 0000 9995` | insufficient_funds |

### IBAN de test SEPA (Stripe)

**⚠️ Ne pas considérer ce tableau comme figé — revérifier auprès de la documentation Stripe à jour au moment de l'exécution réelle des tests, les IBAN et comportements de test peuvent évoluer.**

| IBAN | Comportement |
|---|---|
| `DE89370400440532013000` | Succès |
| Voir doc Stripe SEPA test | Échecs (insuffisance, refus) à confirmer selon les IBAN de test Stripe à jour |

**⚠️ Ce plan ne doit pas être exécuté avant que le schéma de données et les flows de paiement du nouveau modèle (carte + SEPA, autorisation post-paiement) existent réellement dans le code — l'exécuter prématurément produirait des échecs qui ne renseignent sur rien.**

---

## Scénario 1 — Création d'un paiement à recevoir

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 1.1 | Prestataire crée un paiement à recevoir (création manuelle) | `creance` en état `OUVERTE` | [ ] | |
| 1.2 | Vérifier qu'aucune tentative n'est créée automatiquement | 0 `tentative_paiement` à ce stade | [ ] | |
| 1.3 | Le lien de paiement est-il déjà accessible ? | URL éventuellement préparée, mais ni payable ni partageable avant revérification live du compte Connect (cf. PRD §4.2) | [ ] | |

---

## Scénario 2 — Notice préventive (J-5)

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 2.1 | Créance entre dans la fenêtre préventive | `dossier_suivi` → `PRÉVENTION`, notice envoyée | [ ] | |
| 2.2 | Notice envoyée une seconde fois le lendemain (non-régression) | Pas de doublon | [ ] | |

---

## Scénario 3 — Premier règlement volontaire par carte

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 3.1 | Échéance atteinte, rien réglé | `dossier_suivi` → `ÉCHÉANCE`, lien envoyé activement | [ ] | |
| 3.2 | Client clique le lien, paie par carte (4242...) | `tentative_paiement` créée puis `RÉUSSIE` | [ ] | |
| 3.3 | Webhook `payment_intent.succeeded` | `paiement` créé, `creance` → `RÉGLÉE` | [ ] | |
| 3.4 | Commission | `application_fee_amount` = 0 (Early Access) | [ ] | |
| 3.5 | Popup post-paiement | Proposition d'autorisation affichée, moyen carte présélectionné | [ ] | |

---

## Scénario 4 — Premier règlement volontaire par SEPA

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 4.1 | Client choisit SEPA Core au lieu de la carte | Les deux rails proposés au même niveau, aucun masqué par seuil de montant | [ ] | |
| 4.2 | Saisie IBAN + mandat | `tentative_paiement` → `EN_TRAITEMENT` | [ ] | |
| 4.3 | Délai de plusieurs jours ouvrés | La créance reste `OUVERTE`, jamais `RÉGLÉE` avant confirmation réelle | [ ] | |
| 4.4 | Webhook de confirmation SEPA | `tentative_paiement` → `RÉUSSIE`, `paiement` créé, `creance` → `RÉGLÉE` | [ ] | |
| 4.5 | Vérifier qu'aucune confirmation n'a été inférée par écoulement de temps seul | Règle §2.2 du doc 03 respectée | [ ] | |

---

## Scénario 5 — Proposition d'autorisation et acceptation

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 5.1 | Client accepte la proposition post-paiement (carte) | `payment_authorization` → `EN_CONFIGURATION` puis `ACTIVE`, `is_default = true` | [ ] | |
| 5.2 | Client refuse | `payment_authorization` reste `REFUSÉE` ou `NON_PROPOSÉE`, aucun blocage du parcours | [ ] | |
| 5.3 | Client choisit un autre moyen que celui utilisé au premier paiement | Autorisation créée sur le moyen choisi, pas celui du paiement | [ ] | |
| 5.4 | Re-proposition différée après paiements réguliers | Option redevient visible sans nouveau popup insistant — **[HYPOTHÈSE, pas un critère bloquant du MVP]** : seuil exact (3-4 paiements) à calibrer en bêta, cf. PRD §4.4 | [ ] | |

---

## Scénario 6 — Paiement automatique sur créance suivante

| Étape | Action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|
| 6.1 | Nouvelle créance pour le même client × prestataire, autorisation `ACTIVE` | Worker crée une `tentative_paiement` de source `prelevement_auto` à échéance | [ ] | |
| 6.2 | Succès | `paiement` créé, `creance` → `RÉGLÉE`, sans sollicitation du client | [ ] | |
| 6.3 | Échec (provision insuffisante) | `tentative_paiement` → `ÉCHOUÉE`, `creance` reste `OUVERTE`, repasse en flux de lien manuel + notification prestataire | [ ] | |
| 6.4 | Vérifier qu'aucun retry automatique n'est tenté sans politique validée | `retry_policy = none` respecté au MVP | [ ] | |

---

## Scénario 7 — Authentification requise (SCA)

| Étape | Résultat attendu | Statut | Preuve |
|---|---|---|---|
| Carte 3DS (4000 0025...) | `tentative_paiement` → `NÉCESSITE_ACTION_CLIENT` | [ ] | |
| Créance | Reste `OUVERTE`, pas de dégradation d'état | [ ] | |

---

## Scénario 8 — Litige

| Étape | Résultat attendu | Statut | Preuve |
|---|---|---|---|
| Dispute créée (Dashboard test) | `dossier_suivi` → `PAUSE_LITIGE` | [ ] | |
| État de la créance pendant le litige | Inchangé par le seul fait du litige | [ ] | |
| Résolution (won/lost) | `dossier_suivi` sort de `PAUSE_LITIGE`, pas de logique comptable automatique | [ ] | |

---

## Scénario 9 — Remboursement

| Étape | Résultat attendu | Statut | Preuve |
|---|---|---|---|
| Remboursement déclenché explicitement par le prestataire | Refund sur compte connecté | [ ] | |
| Jamais automatique | Aucune action système ne déclenche seule un remboursement | [ ] | |
| Replay webhook | Pas de doublon | [ ] | |

---

## Scénario 10 — Concurrence / idempotence

| Cas | Résultat attendu | Statut | Preuve |
|---|---|---|---|
| Webhook rejoué (même `event_id`) | Claim fenced et effet métier idempotent via `processed_webhook_event` + `stripe_webhook_effect` | [ ] | |
| Lease A expiré, worker B reprend | A ne peut ni renouveler ni finaliser ; B finalise avec son token | [ ] | `pnpm test:stripe-001` |
| Effet A après reprise par B | A ne consomme pas la clé ; B applique et peut rafraîchir la projection live | [x] | `pnpm test:stripe-001` — 20/20 |
| Stripe désactivé | `POST /api/stripe/webhook` retourne `404` sans lire/persister | [x] | Vitest ciblé — 49/49 total ciblé |
| Huit échecs retryables | Terminalisation `failed_terminal` avec raison normalisée | [ ] | `pnpm test:stripe-001` |
| Deux tentatives créées quasi simultanément sur la même créance | Pas de double `paiement` pour un même règlement | [ ] | |
| Webhook reçu avant réponse HTTP de la tentative | État final cohérent | [ ] | |

---

## Commandes

```bash
# Terminal 1 — app
pnpm dev

# Terminal 2 — webhooks Connect
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook

# Vérifier un PI dans le compte connecté
stripe payment_intents retrieve pi_xxx --stripe-account acct_xxx
```

---

## Dette documentée

Si l'exécution n'est pas possible (pas de `sk_test_*`, pas de Connect test) :
- Cocher **[ ] NON EXÉCUTÉ** dans `PRE_DEPLOYMENT_CHECKLIST.md`
- Décision reste **NO-GO PRODUCTION**

---

*Réécrit le 14 juillet 2026 — remplace la version calée sur l'enrôlement obligatoire et la séquence J0/J5/J9/J10.*
