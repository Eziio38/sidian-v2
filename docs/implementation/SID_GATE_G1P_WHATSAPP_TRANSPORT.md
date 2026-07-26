# SIDIAN — Gate G1-P · WhatsApp Cloud Transport

**Lot :** G1-P — WhatsApp Cloud Transport  
**Prérequis :** Communication Channel model (canal abstrait)  
**Décision lot G1-P :** `PASS`  
**Date UTC :** 2026-07-26T12:10:00Z  
**SHA testé :** *(working tree — aucun commit automatique)*

> Synthèse humaine. Non réécrite automatiquement par le harness.

---

## Decision: PASS

| Axe | Statut |
|---|---|
| Architecture | PASS |
| Migration | PASS |
| Transport | PASS |
| Templates | PASS |
| Idempotency | PASS |
| Retries | PASS |
| Webhook | PASS |
| Security | PASS |
| Tests | PASS (`pnpm test:g1-p` → 19) |
| Documentation | PASS |
| Limitations | Documentées |
| Next recommended gate | G1-Q — WhatsApp inbound / réponses Guide |

---

## 1. Architecture

```
Business workflow (inchangé)
  → OutboundMessageService.queueGuidePaymentConfirmation
  → communication_messages (status=queued, idempotency_key)
  → processOutboundMessage
  → WhatsAppTransport (disabled | stub | live Graph)
  → provider_message_id persisté (accepted ≠ delivered)
  → POST /api/whatsapp/webhook (signature) → statuses sent/delivered/read/failed
```

Frontière :

| Couche | Responsabilité |
|---|---|
| Métier | `tenantId`, `protectionId`, variables template — **jamais** E.164 |
| Canal | `channelId` / `whatsapp_sidian` |
| Outbound | persistence + idempotence + retries bornés |
| Transport | Graph/`phone_number_id`, tokens, timeouts |
| Webhook | verify + dedupe + transition statut |

---

## 2. Trust boundaries

1. **Secrets** (`ACCESS_TOKEN`, `APP_SECRET`, verify token) : env serveur uniquement ; jamais loggés.
2. **Webhook POST live** : `X-Hub-Signature-256` HMAC obligatoire ; body borné (512 KiB).
3. **Webhook GET** : challenge Meta avec `SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
4. **Corrélation** : `provider_message_id` → `communication_messages` → `channel_id` → `tenant_id`.  
   `tenant_id` du payload webhook n'est **jamais** une source d'autorité.
5. **RLS** : `communication_messages` lecture authentifiée scopée ; écriture `service_role`.  
   `communication_webhook_events` : `service_role` uniquement.

---

## 3. Modèle d’idempotence

- Clé : `sha256(tenantId|eventType|entityId|occurrenceKey|recipientReference)[:64]`
- Contrainte SQL : `UNIQUE (tenant_id, idempotency_key)`
- Double queue → même row ; retry transport → même row (`attempt_count++`), jamais second message logique.
- Webhook : `UNIQUE (provider_kind, dedupe_key)` avec `dedupe_key = wamid:status`.

---

## 4. Modèle de statut

| Statut | Signification |
|---|---|
| `queued` | Intention persistée, pas d’appel fournisseur |
| `sending` | Claim worker |
| `accepted` | Fournisseur a accepté (`provider_message_id`) — **pas** livraison |
| `sent` | Statut fournisseur « sent » |
| `delivered` | Remis au device |
| `read` | Lu |
| `failed` | Échec terminal |
| `cancelled` | Annulé |

Transitions monotones (`canTransitionMessageStatus`) — régression refusée.

---

## 5. Retries

- `MAX_SEND_ATTEMPTS = 4` (1 + 3)
- Retryable : timeout, network, 5xx, rate limit
- Non retryable : auth, validation, config, template
- Backoff job infra : hors scope si pas de worker ; processor déterministe pour tests

---

## 6. Variables d’environnement

| Variable | Rôle |
|---|---|
| `SIDIAN_WHATSAPP_PROVIDER_ENABLED` | `true`/`false` |
| `SIDIAN_WHATSAPP_TRANSPORT_MODE` | `disabled`/`stub`/`live` |
| `SIDIAN_WHATSAPP_ACCESS_TOKEN` | Bearer Graph (live) |
| `SIDIAN_WHATSAPP_PHONE_NUMBER_ID` | ID technique expéditeur |
| `SIDIAN_WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA (optionnel) |
| `SIDIAN_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Challenge GET |
| `SIDIAN_WHATSAPP_APP_SECRET` | Signature POST |
| `SIDIAN_WHATSAPP_GRAPH_API_VERSION` | défaut `v21.0` |
| `SIDIAN_WHATSAPP_SIDIAN_SENDER_E164` | Métadonnée canal (pas clé Graph) |
| `SIDIAN_WHATSAPP_GUIDE_RECIPIENT_TECHNICAL_ID` | Destinataire technique Guide |
| `SIDIAN_WHATSAPP_HTTP_TIMEOUT_MS` | défaut 8000 |

---

## 7. Endpoints

- `GET /api/whatsapp/webhook` — vérification Meta
- `POST /api/whatsapp/webhook` — notifications de statut

Mode `disabled` → 404.

---

## 8. Mode local

| Mode | Comportement |
|---|---|
| disabled | Aucun appel ; 404 webhook |
| stub | Transport déterministe ; scénarios succès/erreur |
| live | Graph API réel |

Tests : **jamais** d’appel réseau (stub + fetch injectable).

---

## 9. Tests

`pnpm test:g1-p` — 19 PASS :

- résolution / absence numéro API métier
- config live incomplète
- mapping template + variable manquante
- enqueue + envoi stub + idempotence
- timeout retryable / auth non retryable
- Graph AbortError → timeout
- challenge + signature webhook
- delivered/read + dédup + inconnu
- isolation tenant
- exécution concurrente processor (1 envoi)

---

## 10. Limites G1-P

- Pas de `whatsapp_business_personal`
- Pas d’envoi au client final (uniquement Guide / `guide_payment_confirmation`)
- Repo mémoire pour webhook HTTP local (persistance Supabase via migration ; wiring service_role live à finaliser en ops)
- Pas d’inbox inbound / réponses métier complètes
- Interactive list Meta (4 choix) — mapping template externe Cloud à valider en live contrôlé

> **MàJ G1-Q :** le mode live **refuse** désormais un repository webhook mémoire (`assertLiveWebhookPersistence`). Les réponses Guide (Oui/Non/Partiel/Je vérifie) sont traitées — voir `SID_GATE_G1Q_WHATSAPP_INBOUND_ACTIONS.md`.

---

## 11. Procédure live contrôlée

1. Activer `SIDIAN_WHATSAPP_PROVIDER_ENABLED=true` + `TRANSPORT_MODE=live`
2. Renseigner tokens / phone_number_id / app_secret / verify token
3. Pointer le webhook Meta vers `/api/whatsapp/webhook`
4. `ensure_whatsapp_sidian_channel(prestataire)`
5. Queue `guide_payment_confirmation` vers le Guide de test
6. Vérifier `accepted` puis statuses webhook
7. Confirmer absence de secrets dans les logs

---

## 12. Fichiers clés

- `supabase/migrations/20260726150000_g1p_whatsapp_transport.sql`
- `src/lib/communication-channels/whatsapp/**`
- `src/lib/communication-channels/outbound/**`
- `src/app/api/whatsapp/webhook/route.ts`
- `docs/SIDIAN_02_PRD_V2.md` §4.7 (plans Starter/Pro/Business)
- `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` §5.5

---

## Commit proposé (non exécuté)

```
feat(communications): add WhatsApp Sidian transport and delivery tracking
```
