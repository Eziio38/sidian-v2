# Phase 1 — fondations, configuration et sécurité

Date de validation locale : **21 juillet 2026**

Branche : **`develop`**

Statut : **terminée localement ; activation Preview bloquée par configuration
staging manquante**.

## Garanties livrées

- Les écritures navigateur sont retirées de `audit_log`, `message`,
  `approval_request`, `regle`, `dossier_suivi` et `conversation`. Leur lecture
  reste tenant-scopée par RLS.
- Les décisions d’approbation passent par une RPC `SECURITY DEFINER` étroite :
  identité issue du JWT, verrou de ligne, expiration au temps réel, transition
  terminale, replay idempotent et audit transactionnel unique.
- Les invariants d’approbation sont également matérialisés par une contrainte
  SQL ; la rétention historique `ON DELETE SET NULL` de la créance est préservée.
- Les inscriptions, connexions, récupérations/mises à jour de mot de passe,
  callbacks Auth et webhooks Stripe utilisent des quotas persistants atomiques.
  Les IP, emails, codes et identifiants sont pseudonymisés par HMAC avant toute
  persistance. `X-Forwarded-For` n’est pas une source de confiance.
- Le webhook Stripe conserve le `404` immédiat lorsque le module est désactivé,
  contrôle la taille déclarée, applique le quota avant de lire le flux, puis
  conserve le body brut pour la signature.
- Le Proxy crée un UUID de corrélation mais ne contacte Supabase que pour
  `/app/*`. Les routes health, Auth callback, webhook et paiement public restent
  indépendantes de tout refresh de session préalable.
- Les cookies Auth serveur sont `HttpOnly`, `SameSite=Lax`, `Secure` en Preview
  et Production. Les réponses qui les posent sont privées et non cachables.
- Le callback Auth est `no-store`, `noindex/nofollow` et `no-referrer`; son code
  est borné et n’est jamais journalisé.
- Les logs serveur sont structurés, bornés et expurgent secrets, emails, tokens,
  URLs, query strings, Referer, messages et stacks. Les erreurs Auth, quota et
  webhook peuvent être rapprochées via le request ID sans donnée sensible.
- Les headers globaux couvrent CSP, anti-framing, nosniff, HSTS, Permissions
  Policy, COOP/CORP et suppression de `X-Powered-By`. La CSP n’autorise que
  l’origine Supabase configurée, pas tous les projets Supabase.
- `/api/health` ne considère la base connectée qu’après une requête réussie. Sur
  Vercel, une attestation JWT minimale signée par le projet et une sonde
  `service_role` read-only doivent toutes deux réussir.

## Contrat d’environnement Vercel

Un build Preview exige :

- `SIDIAN_ENVIRONMENT=staging` ;
- `NEXT_PUBLIC_APP_URL` identique à `VERCEL_URL` ou `VERCEL_BRANCH_URL` ;
- `NEXT_PUBLIC_SUPABASE_URL` correspondant à
  `SIDIAN_SUPABASE_PROJECT_REF` ;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ;
- `SUPABASE_SERVICE_ROLE_KEY` ;
- `SUPABASE_ENVIRONMENT_ATTESTATION_JWT`, signé par ce projet avec le rôle
  `sidian_environment_attestor` et les claims `sidian_environment`,
  `sidian_project_ref`, `exp`.

La signature est vérifiée par PostgREST avant la RPC minimale
`attest_sidian_environment`. La sonde `service_role_healthcheck` prouve ensuite
que la clé serveur appartient au même projet. Les deux RPC n’exposent aucune
donnée métier et leurs ACL sont mutuellement exclusives.

La configuration distante actuelle n’établit pas cette séparation. Aucune
migration ni écriture Supabase distante n’est donc autorisée tant que le projet
staging et son attestation n’ont pas été configurés et vérifiés manuellement.

## Migrations additives

- `20260721190000_sid_sec_002_005_trust_boundaries.sql`
- `20260721200000_sid_sec_006_rate_limit_categories.sql`
- `20260721200100_sid_sec_006_rate_limit_policy.sql`
- `20260721200200_sid_sec_phase1_hardening.sql`
- `20260721200300_sid_sec_environment_attestation.sql`

Aucune migration préexistante n’a été modifiée.

## Tests dédiés

- `scripts/test-security-trust-boundaries.mjs`
- `scripts/test-sid-sec-006.mjs`
- `scripts/test-sid-sec-environment.mjs`
- tests Vitest Auth, callback, webhook, health, proxy, headers, environnement,
  logger et quotas.

Résultats locaux après reset complet :

- frontières de confiance : **12/12** ;
- quotas persistants : **4/4** ;
- attestation d’environnement : **5/5** ;
- Vitest : **26 fichiers, 185/185 tests** au contrôle final.

La suite complète, le build et les contrôles Git sont consignés dans la matrice
globale après validation finale de la phase.

## Réserves reportées dans leur phase

- La purge bornée des événements de quota doit être planifiée avec les workers
  de Phase 5.
- La CSP conserve `unsafe-inline` pour les scripts Next.js tant qu’une stratégie
  nonce complète n’est pas introduite ; aucun `unsafe-eval` n’est permis hors
  développement.
- Les métriques et alertes externes restent à raccorder avec l’observabilité des
  workers, paiements, emails et IA.
- Les tests staging/Preview restent bloqués par les variables et credentials
  staging absents. Aucune valeur factice n’est acceptée.
