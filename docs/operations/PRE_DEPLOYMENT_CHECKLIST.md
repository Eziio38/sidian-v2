# Sidian — Checklist pré-déploiement

> Document vivant — **réinitialisé le 14 juillet 2026** suite au changement de modèle produit complet.
> Ne cochez un item que si une **preuve** est documentée ci-dessous ou en annexe.
>
> **Ce fichier remplace entièrement la version antérieure** (Lots 0-10, séquence J0/J5/J9/J10, `mission_status`/`invoices`/`enrollments`). Cette version antérieure tracait un vrai historique de travail (374 tests, migrations, RLS) — **mais sur du code qui appartient à l'ancien modèle abandonné.** Ne pas réutiliser ces preuves comme validation du nouveau modèle, même partiellement : le schéma de données, les machines d'état et le flow ont changé de fond en comble (cf. `AGENTS.md`, `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`).

**Décision actuelle : `NO-GO PRODUCTION`** — nouveau modèle en cours d'implémentation, aucune validation E2E encore exécutée dessus.

---

## 1. Bloquants absolus

| Item | Responsable | Statut | Preuve / note |
|---|---|---|---|
| Verrou production paiements automatiques | Tech lead | [ ] À faire | Nom de flag à définir en Phase 3 (cf. plan d'implémentation 03) |
| Aucun paiement live avant validation E2E test | Tech lead | [ ] À faire | Voir §11 |
| Migrations du schéma courant (17 tables, cf. 03 §1) appliquées en staging/prod | Ops | [ ] À faire | |
| Webhook Connect configuré et signé | Ops | [ ] À faire | `STRIPE_CONNECT_WEBHOOK_SECRET` requis |
| Build production réussi | Dev | [ ] À faire | |
| Suite de tests verte | Dev | [ ] À faire | Nouvelle suite à écrire pour le nouveau modèle |
| Rollback documenté (plan en prose) | Tech lead | [x] Terminé | Voir §15 et `PAYMENTS_RUNBOOK.md` — **le plan est écrit, le mécanisme (flag réel, pause des workers) n'est pas encore construit ni testé** |

- [ ] **Audit du code existant terminé** (cf. `AGENTS.md`, méthode de tri : dépend de l'ancien modèle → refaire, neutre → garder)
- [ ] **Décision Go/No-Go manuelle** — voir §16

---

## 2. Base de données et migrations

**Schéma courant (17 tables, cf. 03 §1) :** 13 tables métier initiales + `stripe_customer_binding`, `payment_link`, `stripe_webhook_effect`, `stripe_connect_audit_outbox`.

| Item | Commande | Environnement | Statut | Preuve |
|---|---|---|---|---|
| Migrations du schéma MVP écrites | — | local | [x] Terminé | `supabase/migrations/20260715*` — cf. `docs/implementation/PHASE_2_DATABASE.md` |
| Ordre migrations vérifié | `pnpm supabase:reset` | local | [x] Terminé | 11 migrations (MVP 8 + SID-SEC-001 ×2 + SID-PROD-001) |
| Tests migration (ex. PGlite) | — | local | [ ] À faire | Remplacé par `pnpm test:schema` (rôles réels Supabase local) |
| `supabase db reset` complet | `pnpm supabase:reset` | local Docker | [x] Terminé | Seed sans données métier |
| Types Supabase alignés | `pnpm supabase:types && pnpm typecheck` | local | [x] Terminé | `src/types/database.generated.ts` |
| Migrations appliquées staging | Dashboard Supabase / CI | staging | [ ] À faire | Après diagnostic SID-SEC-001 + validation SID-PROD-001 |
| Migrations appliquées production | Dashboard Supabase | production | [ ] À faire | **Ne pas appliquer sans Go** |
| RLS activée sur toutes les tables `prestataire`-scopées | `pnpm test:schema` | local | [x] Terminé | **33/33** tests schema (+ **54/54** local-guard en préfixe) |
| SID-SEC-001 — intégrité prestataire (ACL SELECT, MAINTAIN révoqué, email canonique, RPC, localOnlyFetch, module cœur testé) | `pnpm test:local-guard` + `pnpm test:schema` + `pnpm test:auth` | local | [x] Terminé localement | **54/54** guard · **33/33** schema · **38/38** Auth ; migrations `20260716220000_*` + `20260717220000_*` ; diagnostic `scripts/diagnose-prestataire-integrity.sql` ; **contre-revue Codex finale puis staging** |
| SID-PROD-001 — clients + paiements à recevoir (RPC, ACL SELECT, EUR, montants, idempotence, archivage bloqué) | `pnpm test:prod-001` | local | [x] Terminé localement (contre-revue Codex **non validée**) | Migration `20260718120000_*` ; UI `/app/clients` + `/app/paiements-a-recevoir` ; doc `PHASE_4_CLIENTS_CREANCES.md` |
| RLS validée sur vrai Supabase (rôles réels) | rôles réels | staging Docker | [ ] À faire | Local validé ; staging après `db push` manuel |

**Risque si non réalisé :** schéma désaligné → webhooks et paiements échouent silencieusement.

### Procédure staging SID-SEC-001 (manuelle)

1. Exécuter `scripts/diagnose-prestataire-integrity.sql` sur staging (lecture seule) — emails non canoniques (`IS DISTINCT FROM lower(btrim(auth.email))`) et commerciaux hors défaut.
2. Revue manuelle des lignes signalées (ne pas écraser de valeurs commerciales légitimes).
3. Appliquer les migrations `20260716220000_*` puis `20260717220000_*` (jamais en prod sans Go).
4. Revalider Auth/RLS en local (`pnpm test:schema`, `pnpm test:auth`) puis smoke Auth staging.
5. Confirmer ACL : `authenticated` = SELECT uniquement (MAINTAIN absent).

### Notes SID-PROD-001 (local)

- Archivage client refusé si créance non archivée (`CLIENT_HAS_ACTIVE_CREANCES`), y compris brouillons.
- Devise `EUR` uniquement ; plafond montants 1…100000000 centimes ; conversion exacte.
- Idempotence créations via `creation_key` (UUID) unique par prestataire.
- Brouillons : création toujours `BROUILLON` ; update draft uniquement.
- Ne pas marquer ce lot comme validé Codex tant que la contre-revue n’est pas rejouée.

---

## 3. Stripe Connect

| Item | Où l'obtenir | Statut | Preuve |
|---|---|---|---|
| Compte plateforme Stripe (test) | Dashboard Stripe | [ ] À faire | |
| Compte Connect test créé + controller props | Onboarding Sidian | [ ] À faire | |
| Compte Connect `charges_enabled=true` | Onboarding hébergé | [ ] À faire | Onboarding humain requis |
| Lien de paiement accessible dès la création du paiement à recevoir | Flux créance | [ ] À faire | Cf. 03 §5, clarification disponibilité/envoi |
| PaymentMethod / mandat SEPA sauvegardé (autorisation post-paiement) | Flux `payment_authorization` | [ ] À faire | |
| Isolation compte A/B (RLS multi-tenant) | Test | [ ] À faire | |
| Direct charge sur compte connecté | Tentative de paiement | [ ] À faire | |
| Commission = 0 (Early Access) | `platform_fee_basis_points` | [ ] À faire | Aucune commission positive codée en dur, cf. 02 §6 / 03 §5 |
| `losses_collector` / `fees_collector` par compte connecté | Dashboard Stripe (par compte) | [ ] À vérifier | Ne jamais supposer, vérifier explicitement pour carte et SEPA séparément |

---

## 4. Webhooks

| Item | Endpoint | Secret | Statut |
|---|---|---|---|
| Connect webhook | `POST /api/stripe/webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` | [ ] À faire |
| Déduplication `event.id` | `processed_webhook_event` (cf. 03 §1) | — | [ ] À faire |
| `event.account` obligatoire Connect | handlers | — | [ ] À faire |
| Replay idempotent | tests | — | [ ] À faire |
| Fencing effet `account.updated` | token + tentative + lease sous verrou | — | [x] 20/20 Stripe local |
| Webhook désactivé | `404` avant lecture du corps/headers et avant clients | — | [x] Vitest ciblé |
| Événements refund/dispute | Connect | — | [ ] À faire |

**Commande test local :**
```bash
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook
```

---

## 5. Communication et automatisation (remplace « Séquences J0/J5/J9/J10 »)

**Aucun calendrier universel figé** — voir `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` §7 (workers) et §4 (registre encadré).

| Worker | Rôle | Statut code | Test E2E |
|---|---|---|---|
| Scanner de prévention | Notice dans la fenêtre préventive configurée, valeur initiale proposée : J-5 ; `dossier_suivi` → `PRÉVENTION` | [ ] À faire | [ ] |
| Scanner d'échéance | Envoi actif du lien, `dossier_suivi` → `ÉCHÉANCE` | [ ] À faire | [ ] |
| Scanner de paiements automatiques | Crée une tentative si autorisation `ACTIVE`/`is_default` | [ ] À faire | [ ] |
| Gestionnaire de tentative échouée | Applique la politique de retry (§6) | [ ] À faire | [ ] |
| Scanner de silence prolongé | `dossier_suivi` → `ESCALADE_HUMAINE` | [ ] À faire | [ ] |
| Scanner de clôture | `dossier_suivi` → `CLOS` | [ ] À faire | [ ] |

- [ ] Aucun email/notice n'est envoyé en double (vérification par `dossier_suivi`)
- [ ] Séquence complète validée bout en bout — voir `STRIPE_TEST_MODE_VALIDATION.md`

---

## 6. Retries (remplace « Retry automatique unique J+17 »)

| Item | Statut | Preuve |
|---|---|---|
| `retry_policy = none` par défaut au MVP | [ ] À faire | Cf. 03 §3 — aucun calendrier figé codé en dur |
| Tentative échouée ne modifie jamais directement l'état de la créance | [ ] À faire | Machine d'état créance vs tentative séparées (03 §2) |
| `authentication_required` → pas de retry auto | [ ] À faire | |
| Politique future dépendante du rail, du code d'échec, de l'état d'autorisation, du litige | [ ] Backlog | Ne pas anticiper avant données Stripe réelles |

---

## 7. Remboursements et litiges

| Item | Statut | Preuve |
|---|---|---|
| Remboursement toujours déclenché explicitement par le prestataire (jamais automatique) | [ ] À faire | |
| Litige → `dossier_suivi` uniquement (`PAUSE_LITIGE`) | [ ] À faire | Ne modifie jamais l'état financier de la créance directement |
| E2E remboursement test Stripe | [ ] À faire | §11 |
| E2E litige simulé | [ ] À faire | §11 |

---

## 8. Sécurité

| Item | Statut | Preuve |
|---|---|---|
| RLS sur toutes les tables `prestataire`-scopées | [ ] À faire | Invariant non négociable, cf. 03 §6 |
| Aucune donnée de carte/IBAN brute stockée — références Stripe uniquement | [ ] À faire | |
| Mandat SEPA vs moyen enregistré carte clairement distingués | [ ] À faire | `payment_authorization.type` |
| Aucune écriture directe du LLM dans Stripe/Supabase | [ ] À faire | Registre encadré, cf. 03 §4/§10 |
| Toute action du registre encadré tracée dans `audit_log` | [ ] À faire | |
| Service role uniquement pour webhooks/cron ; jamais pour écrire un Customer binding | [x] Local | rôle writer validé |
| Rate limiting sur les routes publiques (lien de paiement) | [ ] À faire | |
| Fonctions SECURITY DEFINER — `SET search_path` explicite | [ ] À faire | |

---

## 9. Variables d'environnement

Voir `.env.example`. **Ne jamais committer les valeurs réelles.**

| Variable | Obligatoire | Env | Risque si absente |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Oui | tous | App inutilisable |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Oui | tous | Auth/RLS client cassés |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui | serveur | Webhooks/cron impossibles |
| `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` | Oui (`true` ou `false`) | build/client | Build refusé si absent |
| `SIDIAN_ENVIRONMENT` | Si Stripe actif | serveur | Scope environnement invalide |
| `STRIPE_MODE` | Si Stripe actif | serveur | Test/live incohérent |
| `STRIPE_SECRET_KEY` | Oui | serveur | Aucun appel Stripe |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Oui | client | Paiement cassé |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Oui | serveur | Webhooks Connect rejetés |
| `SUPABASE_STRIPE_BINDING_WRITER_JWT` | Si Stripe actif | serveur | Bindings Customer refusés |
| `OPENAI_API_KEY` (ou équivalent fournisseur configuré) | Oui | serveur | `runAI` indisponible (cf. 03 §10) |

*(Compléter au fil de l'implémentation — Bridge/Powens, Pennylane, autres fournisseurs IA : uniquement si la brique correspondante est effectivement développée, cf. 02 §8 périmètre MVP.)*

---

## 10. Tests

| Commande | Statut | Preuve |
|---|---|---|
| `pnpm typecheck` | [ ] À faire | |
| `pnpm lint` | [ ] À faire | |
| `node scripts/verify-migrations-order.mjs` | [ ] À faire | |
| `pnpm build` | [ ] À faire | |
| Tests unitaires des 4 machines d'état (créance, tentative, autorisation, dossier de suivi) | [ ] À faire | Cf. 03 §2 — tester isolément avant tout branchement Stripe/agent (Phase 2) |
| Tests garde-fous registre encadré (aucune action formelle sans approbation) | [ ] À faire | |

---

## 11. Validation Stripe test mode

Plan détaillé : [`STRIPE_TEST_MODE_VALIDATION.md`](./STRIPE_TEST_MODE_VALIDATION.md) — réécrit pour le nouveau modèle, statut global **NON EXÉCUTÉ**.

Prérequis :
- [ ] `sk_test_*` / `pk_test_*` disponibles
- [ ] Compte Connect test onboardé (`charges_enabled=true`)
- [ ] Migrations du nouveau schéma appliquées sur DB de test
- [ ] Webhook CLI / `STRIPE_CONNECT_WEBHOOK_SECRET` configurés

> Ne pas cocher les scénarios E2E sans exécution réelle documentée.

---

## 12. Activation production des paiements

> **[!] BLOQUANT — ne pas lever sans Go manuel.**

### Conditions de levée (toutes requises)

1. [ ] Tous les scénarios `STRIPE_TEST_MODE_VALIDATION.md` (nouvelle version) passés
2. [ ] Migrations prod appliquées et vérifiées sur le nouveau schéma
3. [ ] Webhook Connect 2xx en staging pendant 24h
4. [ ] RLS validée avec rôles réels
5. [ ] Build production OK
6. [ ] Responsable identifié et décision Go documentée

### Procédure (à exécuter manuellement)

1. Définir `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED=true`, `SIDIAN_ENVIRONMENT=production`, `STRIPE_MODE=live` et toutes les clés Stripe cohérentes
2. Déployer avec le flag activé en production
3. Vérifier T+0 (§13)
4. Surveiller webhooks et workers 24h

---

## 13. Validation post-déploiement

### T+0
- [ ] App disponible
- [ ] Migrations appliquées
- [ ] Webhook Connect 2xx
- [ ] Connect status OK prestataire test
- [ ] Aucun paiement inattendu
- [ ] Workers contrôlés (cf. §5)
- [ ] Logs sans erreur critique

### T+1h
- [ ] Pas de backlog webhook
- [ ] Pas d'erreur Stripe anormale
- [ ] Pas de tentative dupliquée

### T+24h
- [ ] Notices et relances correctement envoyées (dossier de suivi cohérent)
- [ ] Retries conformes à la politique configurée (§6)
- [ ] Commission cohérente (0 % Early Access)
- [ ] Remboursements/litiges cohérents

---

## 14. Dettes connues et legacy

| Dette | Impact | Action |
|---|---|---|
| Ancien schéma (`invoices`, `enrollments`, `mission_status`) | Code legacy à trier | Appliquer la méthode de tri de `AGENTS.md` — dépend de l'ancien modèle → réécrire |
| Agrégation bancaire | Hors MVP | Cf. 03 §12, backlog explicite |
| Intégration Pennylane | Hors MVP, accélérateur futur | Cf. 02 §8 |
| MCP / assistants externes | Backlog, après besoin réel confirmé | Cf. 03 §11 |
| Grille pricing Solo/Studio/Agence | Hypothèse non active | Cf. 02 §6 |

---

## 15. Plan de rollback

Voir [`PAYMENTS_RUNBOOK.md`](./PAYMENTS_RUNBOOK.md) §12 pour le détail. Résumé :

1. [ ] Désactiver le flag de paiements automatiques en production
2. [ ] Mettre en pause les workers (§5)
3. [ ] **Conserver** les webhooks actifs pour réconciliation
4. [ ] Ne **jamais** supprimer `processed_webhook_event` ni les tentatives
5. [ ] Rollback applicatif (redeploy version précédente)
6. [ ] DB : stratégie additive uniquement — pas de DROP colonnes

---

## 16. Décision Go / No-Go

### No-Go automatique (état actuel)

- [x] E2E Stripe test non exécuté (nouveau modèle)
- [x] Nouveau schéma non encore implémenté
- [ ] Migrations prod non appliquées (si prod visée)

### Décision actuelle

| Environnement | Statut |
|---|---|
| Test mode local/dev | **NON PRÊT** — implémentation en cours |
| Staging | **NON PRÊT** |
| Production | **NO-GO PRODUCTION** |

**Responsable décision finale :** _à désigner_
**Date Go production :** _non planifiée_

---

*Réinitialisé le 14 juillet 2026 suite au changement de modèle produit — remplace la checklist Lots 0-10 construite sur `mission_status`/`invoices`/`enrollments`.*
