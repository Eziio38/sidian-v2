# SID Gate — P0 Runtime Automation

Gate d’automatisation runtime MVP : email, scanners, drains outbox, exécuteurs, crons, LLM borné.

**Date :** 2026-07-26  
**Décision runtime :** `PASS`

**Lecture honnête :** toutes les briques P0 backend documentées sont présentes, testées et branchées. Le prélèvement automatique **refuse** l’argent tant que le plafond produit `regle` n’est pas défini (`AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false`) — fail-closed volontaire, pas une brique absente. L’enqueue→drain→Stripe PI est exécutable dès que le plafond produit est prêt.

---

## Decision: PASS

| Critère §8 | Statut |
|---|---|
| Email transactionnel MVP | PASS |
| Scanners + politique dates V2 | PASS |
| Crons sécurisés (`CRON_SECRET`) | PASS |
| Outbox drainées (from-env) | PASS |
| Executors nécessaires | PASS |
| Paiements exécutables sans double effet | PASS (chemin complet + fail-closed plafond) |
| Retries bornés / reprise crash | PASS |
| Dates métier centralisées | PASS (`workflow-policy.ts`) |
| Arrêts workflow corrects | PASS |
| LLM périmètre sûr uniquement | PASS |
| Aucune décision financière LLM | PASS |
| Tests dédiés + suite globale | PASS |
| TypeScript / build | PASS |
| Supabase reset | PASS (CLI projet `2.109.1`) |
| Aucun backend P0 manquant | PASS |

---

## 1. Architecture (flux)

```
Scanner (policy V2)
  → claim lease (runtime_scan_lease)
  → enqueue runtime_job / outbox (idempotent)
  → Cron drains
  → Executor / Provider (Stripe | WhatsApp | Email)
  → Webhook / reconciliation (autorité financière)
```

Règles non négociables :

- Les scanners **n’appellent jamais** Stripe, WhatsApp, Email, LLM.
- Aucun débit depuis un webhook inbound.
- Le domaine (créance / tentative / effets Stripe) reste source d’autorité.
- LLM : texte / extraction brouillon uniquement — **aucun outil financier**.

Modules :

| Domaine | Chemin |
|---|---|
| Email | `src/lib/email/**` |
| Scanners + policy | `src/lib/runtime/scanners/**`, `workflow-policy.ts` |
| Jobs | `src/lib/runtime/jobs/**` |
| Drains | `src/lib/runtime/drains/**` |
| Paiements auto | `src/lib/runtime/payments/**` |
| Notifications / invoice get | `src/lib/runtime/notifications/**` |
| LLM | `src/lib/llm/**` |
| Cron | `src/lib/runtime/cron/**`, `src/app/api/cron/**` |

Migrations : `20260726190000_email_outbox.sql`, `20260726200000_runtime_outbox_leases.sql`, `20260726210000_sid_p0_payment_execution_jobs.sql`, `20260726220000_runtime_jobs.sql` (timestamps uniques ; clash résolu).

Router agent : `create-router.ts` branche payment + notification/invoice + LLM.

---

## 2. Politique calendrier V2 (source unique)

Fichier : `src/lib/runtime/workflow-policy.ts` — version `2026-07-26.v1`.

| Fenêtre | Règle active | Job produit |
|---|---|---|
| Prévention | J-5 → J-1 avant `date_echeance` | `prevention_notice` |
| Échéance | jour J | `due_send_link` (lien seulement si partageable) |
| Silence | échéance + `regle.delai_grace` (défaut 14 j, borné 3–90) | `silence_escalate` → `ESCALADE_HUMAINE` — **jamais** `IRRECOUVRABLE` auto |
| Clôture | créance terminale | `closure_close_dossier` |
| Auto-pay | jour J + checklist §4 | `autopay_intent` (enqueue only) |
| Retries | `retry_policy = none` | `retry_failed_notify` (fallback manuel, **pas** replay Stripe) |

**Décision produit :** les offsets legacy d’enrôlement V1 (`J+5`, `J+9`, `J+10`, `J+15`, `J+17`) **ne sont pas** des règles actives. Voir `REJECTED_LEGACY_ENROLLMENT_OFFSETS_DAYS` et `AGENTS.md`.

Arrêts transverses (éligibilité) : paiement reçu / partiel recalculé / annulation / litige / vérification Guide / autorisation révoquée / créance terminale.

---

## 3. Cron — chemins et horaires

**Mécanisme unique :** Vercel Cron → routes API Next.js. Pas de `pg_cron` / Trigger.dev en parallèle.

Fichier : [`vercel.json`](../../vercel.json).

| Path | Rôle | Schedule (UTC) |
|---|---|---|
| `GET\|POST /api/cron/scanners` | Scanners → enqueue jobs | `20 5 * * *` |
| `GET\|POST /api/cron/drains` | Drains outbox + payment jobs | `*/5 * * * *` |

`maxDuration` = 60s ; budget soft ≈ 50s. Hobby Vercel : `*/5` drains incompatible → passer en quotidien ou monter Pro.

### Auth

```http
Authorization: Bearer <CRON_SECRET>
```

- Secret serveur `CRON_SECRET` (≥ 16, recommandé ≥ 32).
- **Interdit** en query string.
- Aucun tenant libre depuis le caller.
- Fail-closed si secret absent → `503 cron_not_configured`.

Implémentation : `src/lib/runtime/cron/auth.ts`, `src/app/api/cron/_lib/handler.ts`.

### Scanners — source candidats

`createScannerCandidateSourceFromEnv()` → `createSupabaseScannerCandidateSource` (SQL creance / dossier_suivi / regle / tentatives).  
`SCANNER_CANDIDATE_SOURCE_STATUS = "supabase"`.  
`not_configured` **uniquement** si credentials admin absents (`SUPABASE_SERVICE_ROLE_KEY` + URL/anon publics) — **pas** de stub métier.

### Drains

`runScheduledDrains` → factories `*FromEnv` (WhatsApp, Email, Payment Connect audit) + stub notification hors MVP.

---

## 4. Email

- Abstraction `EmailChannel` / `EmailProvider` (Resend HTTP injectable + stub).
- Outbox persistante (`email_outbox`) : `queued` → `processing` → `sent` | `failed` | `dead_letter`.
- Registre typé 8 templates transactionnels (pas de HTML libre dispersé).
- Idempotence par clé métier ; retries bornés (`EMAIL_MAX_SEND_ATTEMPTS = 4`).
- Logs : hash destinataire uniquement — pas d’adresse / subject / body.
- Fail-closed live / production (stub interdit hors `local`).

Env : `SIDIAN_EMAIL_*` (voir `.env.example`).

---

## 5. Drains outbox

| Drain | MVP | Notes |
|---|---|---|
| WhatsApp outbound | actif | Lease SQL / claim batch |
| Email outbound | actif (stub/local) ; live fail-closed si config absente | Aligné module A |
| Payment Connect audit | actif | RPC `drain_stripe_connect_audit_outbox_batch` |
| Notification outbound | **not_in_mvp** (no-op) | Pas d’outbox notif séparée documentée |
| Payment execution jobs | actif si Stripe enabled | Checklist fail-closed ; webhook = SoT |

Claim atomique, lease, backoff, dead-letter, concurrence multi-worker, pas de repo mémoire en chemin live.

---

## 6. Payment executor

- Enqueue scanner / agent → drain borné.
- Checklist 03 §4 : solde, autorisation ACTIVE défaut, Connect payable, plafond regle, devise EUR, pas de tentative active, pas litige/escalade.
- Clé idempotence Stripe stable ; double drain ne recrée pas de PI.
- Sync Stripe `succeeded` → tentative locale `CREEE` / `EN_TRAITEMENT` — **pas** `RÉUSSIE` sans webhook.
- SEPA off-session fermé (`SEPA_PRENOTIFICATION_REQUIRED`).
- Si plafond produit incomplet → `REGLE_AUTO_DEBIT_CEILING_UNDEFINED` (fail-closed, pas d’invention monétaire).
- Flag code : `AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = false` jusqu’à paramètre `regle` dédié (absent de l’enum actuel).

---

## 7. LLM runtime

- Purposes autorisées : conversation, extraction structurée brouillon, texte d’aide, génération sans effet financier.
- Interdits : décider paiement reçu, choisir montant, déclencher débit, muter échéance/statut, exposer tools financiers.
- Modes : `disabled` | `stub` | `live` (`SIDIAN_LLM_*`) ; live fail-closed sans clé.
- Timeouts, retries limités, budgets RPM/tokens, redaction PII/secrets.

---

## 8. Variables d’environnement (synthèse)

| Variable | Usage |
|---|---|
| `CRON_SECRET` | Auth Bearer cron |
| `SUPABASE_SERVICE_ROLE_KEY` | Claims / enqueue service |
| `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` | Gate payment jobs |
| `SIDIAN_EMAIL_*` | Provider email |
| `SIDIAN_WHATSAPP_*` | Drain WhatsApp |
| `SIDIAN_LLM_*` | Runtime LLM |
| `SIDIAN_ENVIRONMENT` | local/staging/production (stub gates) |

---

## 9. Preuves d’exécution (intégration finale)

| Commande | Résultat |
|---|---|
| `pnpm test:email` | PASS (21) |
| `pnpm test:workers` | PASS (29) |
| `pnpm test:outbox` | PASS (13) |
| `pnpm test:payments-runtime` | PASS (22) |
| `pnpm test:llm-runtime` | PASS (19) |
| `pnpm test:g1-p` | PASS (50) |
| `pnpm test:g1-q` | PASS (45) |
| `pnpm test` | PASS (937) |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` | PASS (routes cron + agent listées) |
| `./node_modules/.bin/supabase db reset` | PASS (migrations P0 appliquées) |
| Homebrew `supabase` 2.75.0 | **BLOQUÉ** config (`experimental.pgdelta` / `local_smtp`) — utiliser le CLI projet `2.109.1` |

Intégrité : 45 migrations, timestamps uniques ; create-router = payment + notif/invoice + LLM ; scanners SQL si admin ; drains from-env.

---

## 10. Gaps résiduels (non-bloquants PASS)

1. **Plafond auto-débit produit** — checklist refuse si regle plafond absente (voulu). Paramètre `regle` à ajouter puis `AUTO_DEBIT_REGLE_CEILING_PRODUCT_READY = true`.
2. **Schedule drains `*/5`** — plan Vercel Pro+ requis (Hobby incompatible).
3. **Notification outbox séparée** — hors MVP (no-op documenté).
4. **Invoice emission** — hors MVP ; `invoice.get` = lecture créance.
5. **CLI Homebrew** — ne parse pas `config.toml` actuel ; documenté, contournement = binaire projet.

---

## 11. Fichiers cron (référence)

```
vercel.json
src/app/api/cron/_lib/handler.ts
src/app/api/cron/scanners/route.ts
src/app/api/cron/drains/route.ts
src/lib/runtime/cron/**
```

---

## 12. Limitations

- Soft-deadline peut produire `partial` / `deadline_reached` — relance idempotente OK.
- Ordre de livraison outbox **non garanti** globalement ; idempotence par message.
- LLM stub/disabled : extracteur conversationnel déterministe (pas d’échec disabled côté adapter extract).
- Auto-pay live : argent bloqué jusqu’à décision produit plafond (fail-closed).
- Ne pas ajouter un second scheduler.

---

## 13. Commit proposé

```
feat(runtime): complete Sidian MVP automation and delivery backend
```

Aucun commit automatique dans cette gate.
