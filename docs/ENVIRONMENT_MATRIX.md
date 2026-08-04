# SIDIAN V2 — MATRICE DES VARIABLES D'ENVIRONNEMENT

**Date :** 3 août 2026
**Source :** relevé exhaustif de `process.env` dans `src/`, `next.config.ts` et
`scripts/`, croisé avec `.env.example`.

**Légende**
- **Obligatoire** : ✅ requise · ⚠️ requise sous condition · — optionnelle · ⛔ ne pas définir
- **Secret** : 🔒 ne doit jamais apparaître dans un log, un ticket ou le frontend
- **Validée** : contrôlée automatiquement au build ou au démarrage

> ⚠️ Toute variable préfixée `NEXT_PUBLIC_` est **envoyée au navigateur**.
> Aucun secret ne doit jamais y figurer. L'audit confirme qu'aucun secret n'y
> figure aujourd'hui.

---

## Application

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL staging | URL production | non | toi | ✅ | ⚠️ forme validée au build sur Vercel, mais **retombe silencieusement sur localhost si absente** |
| `SIDIAN_ENVIRONMENT` | `local` | `staging` | `production` | non | toi | ✅ sur Vercel | ✅ cohérence avec `VERCEL_ENV` |

## Supabase

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | locale | projet staging | projet prod | non | Supabase | ✅ | ✅ correspondance avec le project-ref |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | locale | staging | prod | non | Supabase | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | locale | staging | prod | 🔒 | Supabase | ✅ | ✅ |
| `SIDIAN_SUPABASE_PROJECT_REF` | — | ✅ | ✅ | non | Supabase | ⚠️ Vercel | ✅ |
| `SUPABASE_ENVIRONMENT_ATTESTATION_JWT` | — | ✅ | ✅ | 🔒 | toi (JWT signé) | ⚠️ Vercel | ✅ `exp` vérifié — **fait tomber l'app à l'expiration** |
| `SUPABASE_STRIPE_BINDING_WRITER_JWT` | — | ⚠️ | ⚠️ | 🔒 | toi (JWT signé) | ⚠️ si Stripe activé | ✅ `exp` vérifié |
| `SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET` | ✅ | ✅ | ✅ | 🔒 | toi (≥ 32 car.) | ✅ | ❌ **non couverte par la validation au build** |

## Stripe — paiements clients (Connect)

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` | `false` | `true`/`false` | `true` | non | toi | ✅ littéral | ✅ |
| `STRIPE_MODE` | `test` | `test` | `live` | non | toi | ⚠️ si activé | ✅ |
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_test_…` | `sk_live_…` | 🔒 | Stripe | ⚠️ si activé | ✅ préfixe ↔ environnement |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_test_…` | `pk_live_…` | non | Stripe | ⚠️ si activé | ✅ |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_…` | `whsec_…` | `whsec_…` | 🔒 | Stripe | ⚠️ si activé | ✅ |

> **Abonnement Sidian :** aucune variable n'existe. La facturation du produit
> n'est pas implémentée (`USER_ACTIONS_REQUIRED.md` §7.1).

## IA (LLM)

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `SIDIAN_LLM_PROVIDER_ENABLED` | `false` | `true` | `true` | non | toi | — | ✅ |
| `SIDIAN_LLM_TRANSPORT_MODE` | `disabled`/`stub` | `live` | `live` | non | toi | ⚠️ si activé | ✅ fail-closed |
| `SIDIAN_LLM_API_KEY` | — | ✅ | ✅ | 🔒 | fournisseur | ⚠️ si `live` | ✅ |
| `SIDIAN_LLM_BASE_URL` | défaut | ✅ | ✅ | non | fournisseur | — | ⚠️ URL valide, **aucune liste blanche d'hôtes** |
| `SIDIAN_LLM_MODEL` | défaut | ✅ | ✅ | non | toi | — | ⚠️ chaîne libre ≤ 128, **aucune liste de modèles autorisés** |
| `SIDIAN_LLM_HTTP_TIMEOUT_MS` · `_MAX_RETRIES` · `_MAX_OUTPUT_TOKENS` | défauts | défauts | à arbitrer | non | toi | — | ✅ bornes |
| `SIDIAN_LLM_BUDGET_MAX_*` (3 var.) | défauts | à arbitrer | à arbitrer | non | toi | — | ✅ bornes — ⚠️ compteurs **en mémoire du processus**, sans effet entre instances |

## Email (Resend)

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `SIDIAN_EMAIL_PROVIDER_ENABLED` | `false` | `true` | `true` | non | toi | — | ✅ |
| `SIDIAN_EMAIL_TRANSPORT_MODE` | `stub` | `live` | `live` | non | toi | ⚠️ si activé | ✅ `stub` refusé hors local |
| `SIDIAN_EMAIL_API_KEY` | — | ✅ | ✅ | 🔒 | Resend | ⚠️ si `live` | ✅ |
| `SIDIAN_EMAIL_FROM_ADDRESS` | — | ✅ | ✅ | non | toi (domaine vérifié) | ⚠️ si `live` | ✅ format email |
| `SIDIAN_EMAIL_FROM_NAME` · `_REPLY_TO` | — | ✅ | ✅ | non | toi | — | — |
| `SIDIAN_EMAIL_HTTP_TIMEOUT_MS` | défaut | défaut | défaut | non | toi | — | ✅ |

## WhatsApp (Meta Cloud API)

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `SIDIAN_WHATSAPP_PROVIDER_ENABLED` | `false` | `true` | `true` | non | toi | — | ✅ |
| `SIDIAN_WHATSAPP_TRANSPORT_MODE` | `stub` | `live` | `live` | non | toi | ⚠️ si activé | ✅ `stub` refusé hors local |
| `SIDIAN_WHATSAPP_ACCESS_TOKEN` | — | ✅ | ✅ | 🔒 | Meta | ⚠️ si `live` | ✅ |
| `SIDIAN_WHATSAPP_APP_SECRET` | — | ✅ | ✅ | 🔒 | Meta | ⚠️ si `live` | ✅ signature HMAC du webhook |
| `SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | — | ✅ | ✅ | 🔒 | toi | ⚠️ si `live` | ✅ |
| `SIDIAN_WHATSAPP_PHONE_NUMBER_ID` | — | ✅ | ✅ | non | Meta | ⚠️ si `live` | ✅ |
| `SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID` | — | ✅ | ✅ | non | Meta | ⚠️ si `live` | ✅ |
| `SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID` | — | ✅ | ✅ | non | Meta | ⚠️ si `live` | ❌ **absente de la validation live alors que son absence fait échouer l'envoi** |
| `SIDIAN_WHATSAPP_SIDIAN_SENDER_E164` | — | ✅ | ✅ | non | toi | — | — |
| `SIDIAN_WHATSAPP_GRAPH_API_VERSION` · `_HTTP_TIMEOUT_MS` | défauts | défauts | défauts | non | toi | — | ✅ |

## Tâches planifiées

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `CRON_SECRET` | — | ✅ | ✅ | 🔒 | toi (≥ 32 car.) | ⚠️ Vercel | ❌ **jamais validée : son absence fait répondre 503 aux crons, en silence** |

## Développement et tests

| Variable | Local | Staging | Production | Secret | Origine | Obligatoire | Validée |
|---|---|---|---|---|---|---|---|
| `SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW` | — | — | ⛔ | non | toi | — | — · `=1` ouvre `/dev/*` en production |
| `SIDIAN_TEST_DATABASE_URL` · `SIDIAN_TEST_SUPABASE_URL` | ✅ | ⛔ | ⛔ | non | Supabase local | — | ✅ refus si non locale |
| `SIDIAN_G1K_REQUIRE_AUTH` · `SIDIAN_G1L_REQUIRE_AUTH` | — | CI | ⛔ | non | toi | — | — · sans elles, ces suites **se sautent en silence** |

## Fournies par la plateforme — ne pas définir

`NODE_ENV`, `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`.

> ⚠️ **Toute la validation au build est ignorée si `VERCEL_ENV` est absent.**
> Un build hors Vercel ne vérifie donc aucune de ces variables.

## Variables mortes — à supprimer

`OPENAI_API_KEY`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`.
Aucune n'est lue par un chemin de code actif. Les renseigner n'a aucun effet ;
les laisser entretient une confusion sur le fournisseur réellement utilisé.

---

## Contrôles automatiques existants

| Contrôle | Quand | Portée |
|---|---|---|
| `validateDeploymentReadiness()` | build | **Vercel preview/production uniquement** — forme de `NEXT_PUBLIC_APP_URL`, cohérence `SIDIAN_ENVIRONMENT`↔`VERCEL_ENV`, correspondance URL Supabase ↔ project-ref, JWT d'attestation avec `exp` |
| `assertStripeBuildReadiness()` | build | toujours — `NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED` littéral, préfixes `sk_`/`pk_`/`whsec_`, JWT writer avec `exp` |
| Schémas Zod par domaine | 1ᵉʳ appel | Supabase, Stripe, LLM, Email, WhatsApp — fail-closed en mode `live` incomplet |
| `pnpm doctor` | à la demande | présence/absence, jamais la valeur — voir §26 de la mission |

**Angles morts connus :** `CRON_SECRET`,
`SIDIAN_PAYMENT_AUTHORIZATION_TOKEN_SECRET` et
`SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID` ne sont couvertes par aucun
contrôle automatique, alors que les trois sont des dépendances dures.
