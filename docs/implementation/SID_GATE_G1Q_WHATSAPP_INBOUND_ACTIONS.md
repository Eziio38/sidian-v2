# SIDIAN — Gate G1-Q · WhatsApp Inbound Actions

**Lot :** G1-Q — WhatsApp Inbound Actions  
**Prérequis :** G1-P PASS  
**Décision lot G1-Q :** `PASS`  
**Date UTC :** 2026-07-26T12:30:00Z  
**SHA testé :** *(working tree — aucun commit automatique)*

---

## Decision: PASS

| Axe | Statut |
|---|---|
| Multi-task execution | PASS (domaine ∥ parser ∥ persistance ∥ intégration) |
| Architecture | PASS |
| Domain commands | PASS |
| Inbound parser | PASS |
| Correlation | PASS |
| Persistence | PASS |
| Supabase live wiring | PASS (guard + repos ; injection ops) |
| Identity and permissions | PASS |
| Actions | PASS (Oui / Non / Partiel / Je vérifie) |
| Partial payment flow | PASS |
| Idempotency | PASS (provider + métier) |
| Concurrency | PASS |
| Security | PASS |
| Outbound confirmations | PASS (via outbox G1-P) |
| Tests | PASS (`pnpm test:g1-q` → 41) |
| Documentation | PASS |
| Product decisions | Documentées (prudentes) |
| Limitations | Documentées |
| Next recommended gate | G1-R — Déclaration manuelle créance / `declare_manuellement_hors_sidian` |

---

## 1. Architecture inbound

```
Webhook HTTP (HMAC live)
  → parseWhatsAppInboundMessages (aucun domaine)
  → InboundCommunicationService
  → corrélation outbound.provider_message_id
  → IdentityDirectory (canal + senderReference)
  → GuidePayment domain commands
  → OutboundMessageRepository.insertQueued (ack)
```

Trust boundaries :
- tenant uniquement depuis `communication_messages` outbound ;
- jamais de payload Meta / phone_number_id / E.164 dans le domaine ;
- actions via `CommunicationActionKey` (`gpc_0..3` → clés internes).

---

## 2. Mapping actions

| Meta row id | CommunicationActionKey | Commande |
|---|---|---|
| gpc_0 | payment_received_yes | ConfirmPaymentReceived |
| gpc_1 | payment_received_no | ConfirmPaymentNotReceived |
| gpc_2 | payment_received_partial | session + ApplyPartialPaymentReceived |
| gpc_3 | payment_received_checking | MarkPaymentVerificationInProgress |

Texte exact : `oui` / `non` / `paiement partiel`|`partiel` / `je vérifie` (casse/accents).  
Ambigu (`oui merci`, `je crois que oui`) → reject, pas de commande.

---

## 3. Corrélation

`context.id` (reply) → `communication_messages.provider_message_id`  
→ `payload_snapshot.business` (`protectionId`, `occurrenceId`, `amountDueCents`, …)  
→ tenant / channel.

Sans corrélation → `unresolved`, aucune action métier.

---

## 4. Modèle de données

- `communication_inbound_messages`
- `communication_interaction_sessions`
- `guide_payment_confirmation_state`

**Pas** d’usage de `paiement_source.detecte_hors_sidian` (hors MVP / réservé).

---

## 5. Idempotence

1. Provider : `UNIQUE (provider_kind, provider_event_id)`
2. Métier : `sha256(tenant|outboundId|actionKey|sequence)`

---

## 6. Matrice de transitions (domaine)

| Depuis → | Oui | Non | Partiel | Je vérifie |
|---|---|---|---|---|
| awaiting | OK | OK | OK | OK |
| verification | OK | OK | OK | idempotent |
| not_received | OK | idempotent | OK | OK |
| partially | OK (solde) | reject | OK | OK |
| received | idempotent | reject | reject | reject |

---

## 7. Décisions produit (prudentes)

1. **Je vérifie** : n’annule PAS de prélèvement programmé ; `suspendsAutomation: false`. Décision produit ouverte pour une suspension future.
2. **Oui** : neutralise prélèvement *futur* au niveau de l’état Guide (`autoDebitNeutralized`) — n’annule PAS un prélèvement Stripe déjà lancé.
3. **Confirmation Guide** : état dédié, pas d’écriture `paiement` / solde créance tant que `declare_manuellement_hors_sidian` n’est pas livré (prochaine gate recommandée).
4. **Expiration interactive** : 7 jours (temps) + refus domaine si état incompatible.
5. **Session partielle** : TTL 30 min, 3 essais parsing.

---

## 8. Modes

| Mode | Webhook events | Inbound |
|---|---|---|
| disabled | 404 | — |
| stub/test | mémoire OK | mémoire OK |
| live | Supabase obligatoire (`assertLiveWebhookPersistence`) | injection service_role |

---

## 9. Tests

`pnpm test:g1-q` — 41 tests (parser, montants, domaine, service, concurrence, live guard) + régression G1-P.

---

## 10. Limites

- Wiring HTTP live : deps injectables (`setWhatsAppWebhookDeps`) — ops doit brancher client Supabase.
- Pas d’écriture créance / `paiement` (volontaire, prudent).
- Pas d’inbound client final / LLM / media.
- Identity directory applicative (pas encore table `communication_identities`).

---

## Commit proposé (non exécuté)

```
feat(communications): handle WhatsApp guide payment responses
```
