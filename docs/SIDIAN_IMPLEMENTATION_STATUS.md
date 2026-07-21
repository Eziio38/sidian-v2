# Sidian — état d’implémentation du MVP V2

Date de l’audit : **21 juillet 2026**

Branche auditée : **`develop`**

HEAD au début de l’audit : **`734fc0a`** (`fix(home): wire environment badge to real Vercel deploy target`)

Verdict de la Phase 0 : **NOT READY**

## Périmètre et méthode

Cette cartographie confronte l’intégralité du dépôt aux documents d’autorité, dans
l’ordre imposé : `SIDIAN_01_FONDATIONS_V2.md`, `SIDIAN_02_PRD_V2.md`,
`SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md`, puis le design system et les patterns
UI. Les documents legacy n’ont servi à déduire aucune règle active.

L’audit distingue deux états :

- le **HEAD versionné**, qui contient le socle jusqu’aux correctifs
  `SID-STRIPE-002-B` (`20260721170000_*`) ;
- un **lot 002-C préexistant et non commité** trouvé dans le worktree : 12 fichiers
  modifiés et 9 fichiers non suivis, dont la migration additive
  `20260721180000_sid_stripe_002_c_public_display_and_status.sql`. Ce lot a été
  préservé et testé, mais n’est pas attribué au HEAD.

Le Supabase local contient déjà la migration 002-C non suivie. Il est donc en
avance sur le HEAD et le HEAD seul ne reproduit pas exactement l’état local au
moment de cet audit.

### Échelle de criticité

- **P0** — empêche une bêta privée fiable ou ouvre un risque financier majeur.
- **P1** — sécurité, fiabilité ou parcours produit important à corriger avant la bêta.
- **P2** — qualité, opérabilité ou UX significative sans blocage immédiat du cœur.
- **P3** — amélioration mineure ou élément explicitement hors MVP.

Les statuts de la matrice sont limités à : **terminé**, **partiel**, **absent**,
**bloqué par dépendance externe**, **différé explicitement par le PRD**.

## Matrice d’implémentation

| Domaine | Exigence documentaire | État actuel et fichiers concernés | Tests existants | Manque identifié | Criticité | Statut |
|---|---|---|---|---|---|---|
| Configuration des environnements | Séparation stricte local/staging/production, secrets serveur, flags fail-closed (03 §6.7) | Validation Zod dans `src/config/env-public.ts` et `env-server.ts`; Stripe fail-closed dans `next.config.ts`; clients Supabase séparés. | `env-stripe.test.ts`, build local. | Aucune preuve d’appartenance des clés au bon projet; `NEXT_PUBLIC_APP_URL` peut retomber sur localhost en Preview; healthcheck et Preview peuvent être verts sans dépendances critiques. | P1 | partiel |
| Authentification | Email/mot de passe, confirmation, récupération, session serveur (02 §2bis; 03 §6.1) | Pages et actions dans `src/app/{connexion,inscription,mot-de-passe-oublie,reinitialiser-mot-de-passe}` et `src/lib/auth/*`; `getUser()` serveur. | `test-auth.mjs` : 38/38. | Aucun rate limit persistant Auth/callback; bornes incomplètes; cookies non vérifiés en Preview; aucun E2E réel. | P1 | partiel |
| Création de compte | Compte confirmé, acceptations claires, entrée dans l’onboarding (02 §2bis) | Inscription et confirmation Supabase opérationnelles localement; CGU/confidentialité exigées dans le formulaire. | Tests Auth et formulaires. | Livraison email staging non testée; aucune version/date d’acceptation ni liens juridiques; parcours après confirmation incomplet. | P1 | partiel |
| Onboarding prestataire | Identité → profil agent → premier client → premier paiement → valeur → Stripe contextuel (02 §2bis) | RPC idempotente `ensure_prestataire_for_current_user`; pages Clients et Paiements à recevoir séparées. | Auth, schéma, PROD-001. | Aucun onboarding guidé, aucun choix de profil agent, aucune progression et aucune action UI Connect. | P0 | partiel |
| Stripe Connect | Express France, scope tenant, état réel visible, activation contextuelle (02 §2bis; 03 §5.2) | Provisioning, réconciliation par operation key, Account Link, projection, outbox et fencing dans `src/lib/stripe/connect/*`; migrations Stripe 001. | Stripe 001 : 20/20; Vitest Connect. | `ensureConnectedAccountForCurrentPrestataire` et `createConnectedAccountLink` ne sont appelées par aucune page/action produit; aucune validation Stripe test réelle. | P0 | partiel |
| Clients payeurs | CRUD tenant-scopé et relation stable avec le prestataire (02 §1/§2) | RPC étroites, RLS, canonisation et archivage logique dans `src/lib/clients/*` et `SID-PROD-001`; UI `/app/clients`. | PROD-001 et tests formulaires. | Pas de fiche/historique relationnel complet ni de parcours onboarding; validation staging absente. | P1 | partiel |
| Paiements à recevoir | Création manuelle EUR, échéance, référence, états, solde, historique, dossier (02 §1/§4; 03 §2) | Brouillon EUR, édition bornée, ouverture, archivage et liste dans `src/lib/creances/*`, actions et migrations PROD-001/002. | PROD-001 : 50/50; Stripe 002. | Pas d’annulation métier sûre, de déclaration hors Sidian auditée, de dossier piloté ni d’historique détaillé; archivage ne révoque pas le lien/session. | P0 | partiel |
| Paiement manuel volontaire | Premier règlement volontaire, serveur uniquement, Stripe autoritatif (02 §4.3/§4.4) | Checkout Connect en direct charge, Customer scopé, claim/lease/idempotence, EUR et rails live dans `src/lib/stripe/checkout/*`. | Stripe 002-A/B; Vitest Checkout. | Pas de test Stripe test réel; identité PaymentIntent/session/tentative à durcir; aucun parcours partiel choisi par le payeur. | P0 | partiel |
| Liens publics | URL stable opaque, hash seul, préparée puis partageable uniquement si payable (02 §4.2; 03 §1) | Token 256 bits, hash seul, révocation et quotas persistants; `/p/[token]`. Le lot dirty 002-C enrichit l’affichage. | Stripe 002-A; `public-security.test.ts`; 002-C dirty. | L’UI HEAD présente un lien comme partageable sans payabilité live; token montré une seule fois avant Connect; pas d’expiration du lien; 002-C décide encore l’affichage sur projection locale. | P0 | partiel |
| Checkout | Session fraîche si payable, direct charge, commission autorisée, moyens réellement actifs (02 §4.4; 03 §5) | Sessions créées côté serveur avec clé stable, `application_fee_amount`, métadonnées minimales, carte/SEPA selon capacités live; correctifs F1/F4/F5 au HEAD. | 002-B : 18/18; Vitest inclut carte active/SEPA inactive et double clic. | Tests contractuels seulement; aucune preuve carte/SEPA/3DS Connect test; réparation des sessions bloquées absente. | P0 | partiel |
| Webhooks | Body brut signé, claim fencé, idempotence, retries, événements paiement/setup/litige (03 §5.1bis) | Route bornée à 1 Mio, signature, lease token+attempt, huit retries et registre d’effet dans `src/lib/stripe/webhooks/*`. | Route, Connect services, payment effects, 002-B. | `requires_action` absent; événements setup/detach/mandate ignorés; orphelins processing/failed/dispute insuffisamment audités; pas de worker de reprise. | P0 | partiel |
| Paiements confirmés | Création unique après signal provider fiable; jamais depuis le retour navigateur (03 §2.2/§5) | Succès EUR fencé, paiement unique et recalcul transactionnel; orphelin succeeded → audit + approbation (F2/F5). | 002-B : succès, replay, ordre inversé, trop-perçu. | Concordance stricte PI ↔ tentative/session/Customer à renforcer; staging non validé; remboursements/reversals absents. | P0 | partiel |
| Paiements partiels | Solde = somme des paiements confirmés, états indépendants (02 §4.4; 03 §2.1) | Recalcul SQL vers `PARTIELLEMENT_REGLEE` puis `REGLEE`; agrégation UI dans le lot 002-C. | Tests 002-B partiels. | Checkout demande toujours tout le solde; aucun parcours utilisateur de paiement partiel; preuve staging absente. | P1 | partiel |
| Annulation | Annulation sûre sans mutation financière navigateur; reprise propre (03 §2/§5) | `/p/annule` est en lecture seule; `checkout.session.expired` annule la tentative. | 002-B/002-C. | Aucune commande d’annulation du paiement à recevoir, révocation transactionnelle du lien ou expiration de Session ouverte. | P1 | partiel |
| Litiges | Pause des automatismes, escalade humaine, paiement confirmé intact (03 §5.1bis) | `charge.dispute.created` rattaché crée audit + approbation sans réécrire le paiement. | Test dédié 002-B. | Pas de pause réelle du dossier/autorisation/communications; dispute orpheline silencieuse; aucun suivi won/lost ni UI. | P0 | partiel |
| Autorisations futures | Proposition après premier paiement, Setup Session, preuve, révocation, off-session (02 §4.5; 03 §2.3/§4) | Table, contraintes et index `payment_authorization` uniquement. | Tests structurels Stripe 001. | Aucun parcours de proposition/setup, activation/révocation, webhooks, débit off-session ni prénotification validée. Validation juridique/configuration SEPA encore requise avant activation réelle. | P0 | absent |
| Réconciliation financière | Comparer Stripe et projection, auditer et réparer idempotemment les cas sûrs (03 §5/§6.6) | Réconciliation du provisioning Connect et procédure manuelle de replay dans le runbook. | Tests Connect de reprise. | Aucune commande financière de comparaison/réparation ni scanner de sessions/tentatives bloquées. | P0 | absent |
| Agent Sidian | Abstraction fournisseur, prompts versionnés, sorties structurées, garde-fous, mode dégradé (01 P3/P9/P10; 03 §10) | Seule la lecture typée de `OPENAI_API_KEY` existe. | Aucun. | Registre IA, profils, tâches, validation, quotas, kill switch, audit et interface entièrement absents. | P0 | absent |
| Conversations et messages | Fil probatoire, provenance serveur, réponses et isolation (02 §3; 03 §3/§4) | Tables, RLS, scopes et immutabilité après insertion. | Schéma/RLS. | Aucun service/UI/email entrant; `authenticated` peut choisir `emetteur` et `actor_type` lors de l’insertion : provenance falsifiable. | P0 | partiel |
| Règles | Défauts sûrs, instruction naturelle reformulée puis confirmée, exécution déterministe (02 §3) | Table `regle` et enums. | Tests de scope structurels. | Aucun moteur, valeurs par défaut produit, confirmation, service ou UI; CRUD navigateur direct encore autorisé. | P0 | partiel |
| Demandes d’approbation | Création serveur; payload immuable; décision humaine séparée (03 §4/§6.2) | Table et créations serveur pour rapprochement, dépassement et litige. | 002-B et schéma. | `authenticated` peut insérer et modifier payload/statut/décision; aucune RPC de décision ni UI. | P0 | partiel |
| Audit log | Primitive de confiance, append-only, provenance actor/provider/model (03 §4/§6.2) | Table, trigger anti-update/delete et traces Stripe. | Schéma, Auth, Stripe. | `authenticated` peut forger une insertion; aucune primitive générique ni correlation ID. | P0 | partiel |
| Dossier de suivi | Machine relationnelle indépendante et transitions déterministes (03 §2.4/§7) | Table et unicité par paiement à recevoir. | Schéma. | DML navigateur direct, aucun service/worker, aucune pause litige ou clôture automatique. | P0 | partiel |
| Emails | Notices, lien, confirmations, échecs, réponses et déduplication (02 §3/§4; 03 §6.6/§7) | Variables d’environnement futures uniquement. | Aucun. | Aucun fournisseur, outbox, templates, livraison, reprise, webhook entrant ou test. | P0 | absent |
| Crons/workers | Prévention, échéance, auto-paiement, échec, silence, clôture; leases et retries (03 §7) | Documentation seulement. | Aucun. | Aucun scheduler, claim/lease métier, dead-letter, audit ou test. | P0 | absent |
| Intégration facturation | Création manuelle au MVP; outil tiers/Pennylane hors chemin critique (01 §6; 02 §8; 03 §5.4) | `reference_externe` facultative; aucun couplage tiers. | PROD-001. | Architecture future seulement; aucune intégration nécessaire au MVP. | P3 | différé explicitement par le PRD |
| Dashboard | Total à recevoir, confirmé, en cours, échéances, actions, événements sans mélange d’états (02 §7) | `/app` affiche seulement deux cartes de navigation. | Aucun. | Tous les indicateurs et événements opérationnels sont absents. | P0 | absent |
| Paramètres | Profil, agent, règles et état Stripe configurables (02 §2bis/§3) | Aucune route `/app/parametres`. | Aucun. | Aucun écran ni commande sûre pour nom, profil agent, règles et configuration. | P1 | absent |
| Design system | Shell métier, sidebar/contenu/rail, tokens et patterns cohérents | Outfit, couleurs et composants élémentaires; `AppShell` actuel à en-tête horizontal. | Tests composants ponctuels. | Shell non conforme au layout documenté, hiérarchie faible, formulaires répétés dans les listes, theming incomplet. | P1 | partiel |
| Accessibilité | Clavier, focus, labels, annonces, contraste et responsive | Landmarks, labels et `role=alert` présents sur plusieurs formulaires. | Aucun test a11y. | Focus manquant sur plusieurs actions, cibles petites, `aria-current`/annonces async absents; contrastes mesurés sous 4,5:1 dans certains couples. | P1 | partiel |
| Observabilité | Logs structurés nettoyés, correlation ID, métriques/alertes paiement/IA/email (03 §8) | `/api/health`, états webhook persistants, outbox et erreurs normalisées. | Tests health/Stripe indirects. | Pas de logger commun, correlation ID, métriques, alertes, instrumentation ni health gate strict en Preview. | P1 | partiel |
| Sécurité applicative | RLS, moindre privilège, CSP/headers, rate limits, entrées bornées, primitives de confiance (03 §6) | Bonne isolation tenant et interdiction des écritures financières navigateur; F3/F4 présents; aucun secret réel détecté. | Schéma/RLS, Auth, Stripe et tests publics. | SID-SEC-002 à 006 ouverts : audit/messages/approbations/règles/dossier falsifiables, CSP et headers globaux absents, Auth/webhook/IA non limités. | P0 | partiel |
| Tests | Unitaires, SQL/RLS, intégration, Stripe, replay, concurrence et E2E staging (phase 8) | Bonne base locale : scripts SQL et 14 fichiers Vitest. | Suite locale complète verte le 21/07/2026. | Aucun Playwright/CI, aucun des parcours E2E staging, aucun Stripe test réel, aucun test agent/email/worker/a11y. | P0 | partiel |
| Déploiement Preview | Preview sur staging + Stripe test, logs et smoke tests (phase 9) | Mapping `VERCEL_ENV=preview` vers `staging` dans le code. | Aucun test distant disponible. | Aucun URL/ID/log de Preview ni preuve Supabase staging/Stripe test; aucune CI versionnée; migrations distantes manuelles. | P0 | bloqué par dépendance externe |
| Données de démonstration staging | Jeu fictif réaliste, jamais créé automatiquement en production (phase 7) | `supabase/seed.sql` vide. | Aucun. | Aucun scénario démontrable ni garde d’environnement pour un seed staging. | P1 | absent |
| Préparation Production | Checklist complète, rollback, sauvegarde, risques et validations manuelles (phase 9) | Checklists et runbook existants, tous explicitement NO-GO/non exécutés. | Aucun contrôle production, conformément à l’interdiction. | `SIDIAN_PRODUCTION_READINESS.md` absent; checklists obsolètes; staging et parcours critiques non validés. | P1 | partiel |

## Invariants déjà démontrés localement

- isolation tenant RLS et absence d’écriture financière depuis le navigateur ;
- aucune donnée carte/IBAN brute stockée ;
- fonctions `SECURITY DEFINER` locales avec `search_path` explicite ;
- onboarding prestataire idempotent et scopé à l’utilisateur Auth confirmé ;
- création clients/paiements à recevoir idempotente et EUR uniquement ;
- provisioning Stripe Connect et webhooks fencés ;
- création Checkout côté serveur, direct charge, rails dérivés du compte live ;
- succès financier EUR idempotent, paiements partiels recalculés depuis les
  paiements confirmés, et succès orphelin escaladé durablement ;
- routes `/p/*` en `no-store`, `no-referrer`, `noindex/nofollow` ;
- premier `X-Forwarded-For` ignoré au profit des en-têtes de plateforme prévus ;
- aucun secret réel détecté dans les fichiers suivis par la recherche ciblée.

Ces garanties locales ne valent pas validation Stripe test, staging ou Preview.

## Contrôles réellement exécutés pendant la Phase 0

| Commande | Résultat |
|---|---|
| `pnpm test` | Réussi après autorisation loopback : guard 54/54, schéma/RLS 33/33, Auth 38/38, PROD-001 50/50, Stripe 001 20/20, Stripe 002-A 12/12, Stripe 002-B 18/18, Stripe 002-C dirty 12/12, Vitest 14 fichiers et 117/117 tests. |
| `pnpm typecheck` | Réussi. |
| `pnpm lint` | Réussi. |
| `pnpm build` | Réussi avec la configuration locale et Stripe désactivé; 15 routes générées. |
| Recherche de secrets | Aucun secret réel détecté; uniquement fixtures locales et placeholders de test. |
| Audit imports `service_role` | Usage limité aux modules serveur; aucune importation client détectée. |

Le premier lancement de `pnpm test` dans le sandbox a échoué sur `listen EPERM
127.0.0.1`; la même suite relancée avec l’autorisation loopback a réussi. Aucun
test n’a été masqué ni ignoré.

## Bloqueurs de bêta identifiés

1. Connect n’est pas actionnable depuis l’interface et n’a pas été validé avec un
   vrai compte Connect Stripe test.
2. L’identité PaymentIntent/session/tentative doit être recoupée strictement avant
   toute exposition à de vrais paiements.
3. Les autorisations futures et les débits off-session du MVP sont absents; la
   validation juridique/configuration SEPA reste une dépendance externe avant
   activation réelle.
4. Agent Sidian, emails, workers, dashboard et réconciliation financière sont
   absents.
5. `audit_log`, messages, approbations, règles et dossier de suivi ne passent pas
   encore tous par des primitives serveur de confiance.
6. Aucun E2E, staging aligné ou déploiement Preview vérifiable n’est disponible.

## Réserves documentaires

- `PRE_DEPLOYMENT_CHECKLIST.md` et certains documents d’implémentation contiennent
  des compteurs ou états devenus obsolètes.
- `PAYMENTS_RUNBOOK.md` décrit par endroits des workers, pauses litige,
  remboursements ou transitions manuelles qui ne sont pas implémentés.
- `SIDIAN_UI_PATTERNS.md` conserve quelques libellés historiques « Contrats » ; le
  vocabulaire V2 « Paiements à recevoir » prime.
- Le statut « validé localement » du lot 002-C appartient au worktree non commité,
  pas au HEAD audité.

## Décision de passage

La Phase 0 est terminée : l’état est cartographié et les écarts sont priorisés.
Le produit reste **NOT READY** pour une bêta privée tant que les P0 ci-dessus ne
sont pas traités et démontrés en staging/Preview. Aucun environnement Production
n’a été consulté ou modifié.
