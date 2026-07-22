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

L’audit initial distinguait le HEAD versionné, arrêté aux correctifs
`SID-STRIPE-002-B` (`20260721170000_*`), d’un lot 002-C préexistant trouvé dans
le worktree. Ce lot a été préservé, audité, testé puis intégré séparément dans le
commit `69668c2` avec sa migration additive
`20260721180000_sid_stripe_002_c_public_display_and_status.sql`.

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
| Configuration des environnements | Séparation stricte local/staging/production, secrets serveur, flags fail-closed (03 §6.7) | Validation typée, Stripe fail-closed, URL Preview liée aux hostnames Vercel, origine Supabase liée à son ref, attestation JWT minimale vérifiée par PostgREST et sonde read-only de la `service_role`. | `env-stripe`, `env-attestation`, `http-security`, script SQL d’attestation. | Les variables/claims staging ne sont pas encore configurés à distance : le prochain build Preview doit échouer fermé jusqu’à leur installation autorisée. | P0 | bloqué par dépendance externe |
| Authentification | Email/mot de passe, confirmation, récupération, session serveur (02 §2bis; 03 §6.1) | Pages/actions serveur, `getUser()`, quotas persistants IP+identité, champs bornés, cookies HttpOnly/Secure et callbacks privés/no-referrer. | Auth 38/38; tests actions, callback, schémas, proxy et cookies. | Livraison email staging, acceptations juridiques versionnées et E2E réel encore absents. | P1 | partiel |
| Création de compte | Compte confirmé, acceptations claires, entrée dans l’onboarding (02 §2bis) | Inscription et confirmation Supabase opérationnelles localement; CGU/confidentialité exigées dans le formulaire. | Tests Auth et formulaires. | Livraison email staging non testée; aucune version/date d’acceptation ni liens juridiques; parcours après confirmation incomplet. | P1 | partiel |
| Onboarding prestataire | Identité → profil agent → premier client → premier paiement → valeur → Stripe contextuel (02 §2bis) | `/app/demarrage` matérialise quatre étapes réelles : profil audité, client, paiement à recevoir, puis Stripe seulement après création du paiement. | Auth, PROD-001, SID-PROD-003 et Vitest onboarding/profil. | Le premier envoi dépend encore des emails/workers de Phase 5 ; parcours staging non validé. | P0 | partiel |
| Stripe Connect | Express France, scope tenant, état réel visible, activation contextuelle (02 §2bis; 03 §5.2) | `/app/connexion-stripe` appelle le provisioning/réconciliation existant, relit Stripe live, expose les capacités sans identifiant et crée un Account Link `currently_due` uniquement si nécessaire. | Stripe 001; 6 fichiers Vitest Connect, 48/48. | Aucun vrai parcours Account Link/Connect Stripe test n’a encore été exécuté en staging. | P0 | partiel |
| Clients payeurs | CRUD tenant-scopé et relation stable avec le prestataire (02 §1/§2) | RPC étroites, RLS, canonisation et archivage logique dans `src/lib/clients/*` et `SID-PROD-001`; UI `/app/clients`. | PROD-001 et tests formulaires. | Pas de fiche/historique relationnel complet ni de parcours onboarding; validation staging absente. | P1 | partiel |
| Paiements à recevoir | Création manuelle EUR, échéance, référence, états, solde, historique, dossier (02 §1/§4; 03 §2) | Brouillon/édition/ouverture plus détail financier, historique expurgé, dossier pilotable et annulation serveur atomique via SID-PROD-002. Les règlements hors Sidian restent volontairement hors MVP (PRD §4.6/§8). | PROD-001 50/50; SID-PROD-002 14/14; Stripe 002; Vitest détail/workflows. | Pas encore d’envoi actif, de worker de suivi ni de réconciliation d’une Session Stripe en vol. | P0 | partiel |
| Paiement manuel volontaire | Premier règlement volontaire, serveur uniquement, Stripe autoritatif (02 §4.3/§4.4) | Checkout Connect en direct charge, Customer scopé, claim/lease/idempotence, EUR et rails live dans `src/lib/stripe/checkout/*`. | Stripe 002-A/B; Vitest Checkout. | Pas de test Stripe test réel; identité PaymentIntent/session/tentative à durcir; aucun parcours partiel choisi par le payeur. | P0 | partiel |
| Liens publics | URL stable opaque, hash seul, préparée puis partageable uniquement si payable (02 §4.2; 03 §1) | Token 256 bits, hash seul, révocation, quotas persistants et affichage public enrichi par Stripe 002-C; `/p/[token]`. | Stripe 002-A/002-C; `public-security.test.ts`. | Le token est montré une seule fois avant Connect; pas d’expiration du lien; l’affichage de disponibilité reste fondé sur une projection serveur qui doit être réconciliée avec Stripe. | P0 | partiel |
| Checkout | Session fraîche si payable, direct charge, commission autorisée, moyens réellement actifs (02 §4.4; 03 §5) | Sessions créées côté serveur avec clé stable, `application_fee_amount`, métadonnées minimales, carte/SEPA selon capacités live; correctifs F1/F4/F5 au HEAD. | 002-B : 18/18; Vitest inclut carte active/SEPA inactive et double clic. | Tests contractuels seulement; aucune preuve carte/SEPA/3DS Connect test; réparation des sessions bloquées absente. | P0 | partiel |
| Webhooks | Body brut signé, claim fencé, idempotence, retries, événements paiement/setup/litige (03 §5.1bis) | Route bornée à 1 Mio, signature, lease token+attempt, retries, registre d’effet ; handlers setup + audit orphelin processing/failed/dispute + projection expiration Checkout (SID-STRIPE-003). | Route, Connect services, payment effects, 002-B, orphan audit 6/6. | `requires_action` absent ; pas de worker de reprise ; staging Stripe non validé. | P0 | partiel |
| Paiements confirmés | Création unique après signal provider fiable; jamais depuis le retour navigateur (03 §2.2/§5) | Succès EUR fencé, paiement unique et recalcul transactionnel; orphelin succeeded → audit + approbation (F2/F5). | 002-B : succès, replay, ordre inversé, trop-perçu. | Concordance stricte PI ↔ tentative/session/Customer à renforcer; staging non validé; remboursements/reversals absents. | P0 | partiel |
| Paiements partiels | Solde = somme des paiements confirmés, états indépendants (02 §4.4; 03 §2.1) | Recalcul SQL vers `PARTIELLEMENT_REGLEE` puis `REGLEE`; agrégation UI dans le lot 002-C. | Tests 002-B partiels. | Checkout demande toujours tout le solde; aucun parcours utilisateur de paiement partiel; preuve staging absente. | P1 | partiel |
| Annulation | Annulation sûre sans mutation financière navigateur; reprise propre (03 §2/§5) | Barrière serveur Stripe live puis commande `cancel_current_payment_receivable` tenant-safe : identité Connect/Session/EUR recoupée, Session ouverte expirée avec idempotence, résultats ambigus refusés ; la transaction locale refuse fonds confirmés/tentative non terminale, révoque le lien, clôt le dossier et audite. | SID-PROD-002, garde-fous P1 8/8, 002-B/002-C et Vitest workflows. | Une Session expirée dont le webhook local n’a pas encore terminalisé la tentative reste refusée fermée jusqu’au rapprochement. | P1 | partiel |
| Litiges | Pause des automatismes, escalade humaine, paiement confirmé intact (03 §5.1bis) | `charge.dispute.created` rattaché crée audit + approbation sans réécrire le paiement. | Test dédié 002-B. | P1 documentaire bloquant : §5.1bis exige `ESCALADE_HUMAINE`, mais §2.4 rend `CLOS` terminal alors qu’une contestation peut arriver après clôture. Pas de pause réelle du dossier/autorisation/communications; dispute orpheline silencieuse; aucun suivi won/lost ni UI. | P0 | partiel |
| Autorisations futures | Proposition après premier paiement, Setup Session, preuve, révocation, off-session (02 §4.5; 03 §2.3/§4) | SID-STRIPE-003 local : proposition post-Checkout, Setup Session fencée, tokens HMAC dédiés (hash seul), webhooks setup/mandate/detach, fail-closed SEPA off-session, marqueur `legacy_incomplete` pour projections pré-003. | `test:stripe-003` 11/11 ; Vitest authorizations/webhooks. | Aucune migration distante ; validation juridique/prénotification SEPA et parcours Stripe test staging encore requis avant activation réelle off-session. | P0 | partiel |
| Réconciliation financière | Comparer Stripe et projection, auditer et réparer idempotemment les cas sûrs (03 §5/§6.6) | SID-PROD-004 local : relecture Stripe live, lease `reconciliation:*`, effets via primitives webhook, registre `payment_reconciliation_issue` sans effet ambigu ; action prestataire sur le détail créance. | `test:prod-004` 9/9 ; Vitest reconciliation. | Aucune migration distante ; pas de scanner batch ni worker de reprise automatique. | P0 | partiel |
| Agent Sidian | Abstraction fournisseur, prompts versionnés, sorties structurées, garde-fous, mode dégradé (01 P3/P9/P10; 03 §10) | Seule la lecture typée de `OPENAI_API_KEY` existe. | Aucun. | Registre IA, profils, tâches, validation, quotas, kill switch, audit et interface entièrement absents. | P0 | absent |
| Conversations et messages | Fil probatoire, provenance serveur, réponses et isolation (02 §3; 03 §3/§4) | Tables/RLS/scopes ; écriture navigateur supprimée, provenance désormais réservée aux primitives serveur. | Schéma/RLS et trust boundaries 12/12. | Aucun service/UI/email entrant ou moteur de conversation. | P0 | partiel |
| Règles | Défauts sûrs, instruction naturelle reformulée puis confirmée, exécution déterministe (02 §3) | Table/enums en lecture tenant-scopée ; CRUD navigateur supprimé. | Trust boundaries et schéma. | Aucun moteur, preset documentaire suffisamment précis, confirmation, service ou UI. | P0 | partiel |
| Demandes d’approbation | Création serveur; payload immuable; décision humaine séparée (03 §4/§6.2) | RPC tenant-safe verrouillée, expiration réelle, replay idempotent, audit atomique et UI `/app/approbations` qui ne transmet que l’identifiant et la décision. | Trust boundaries 12/12; 002-B; tests action/présentation. | Les exécuteurs métier post-approbation appartiennent aux phases Agent/workers ; une approbation financière ne répare volontairement rien seule. | P0 | partiel |
| Audit log | Primitive de confiance, append-only, provenance actor/provider/model (03 §4/§6.2) | INSERT navigateur supprimé ; immutabilité, scope tenant, traces Stripe/approbations et logger corrélé nettoyé. | Schéma, Stripe, trust boundaries, logger. | Primitive générique et vues produit encore absentes ; métriques/alertes non raccordées. | P1 | partiel |
| Dossier de suivi | Machine relationnelle indépendante et transitions déterministes (03 §2.4/§7) | RPC de création/transition tenant-safe, matrice bornée, verrou créance en premier, replay idempotent et UI dans le détail ; un état financier terminal n’autorise plus que `CLOS`, lui-même terminal. | SID-PROD-002 14/14, garde-fous P1 8/8, trust boundaries et Vitest transitions. | Les workers automatiques restent à construire ; l’exception éventuelle pour une contestation bancaire après clôture est bloquée par la contradiction V2 documentée. | P0 | partiel |
| Emails | Notices, lien, confirmations, échecs, réponses et déduplication (02 §3/§4; 03 §6.6/§7) | Variables d’environnement futures uniquement. | Aucun. | Aucun fournisseur, outbox, templates, livraison, reprise, webhook entrant ou test. | P0 | absent |
| Crons/workers | Prévention, échéance, auto-paiement, échec, silence, clôture; leases et retries (03 §7) | Documentation seulement. | Aucun. | Aucun scheduler, claim/lease métier, dead-letter, audit ou test. | P0 | absent |
| Intégration facturation | Création manuelle au MVP; outil tiers/Pennylane hors chemin critique (01 §6; 02 §8; 03 §5.4) | `reference_externe` facultative; aucun couplage tiers. | PROD-001. | Architecture future seulement; aucune intégration nécessaire au MVP. | P3 | différé explicitement par le PRD |
| Dashboard | Total à recevoir, confirmé, en cours, échéances, actions, événements sans mélange d’états (02 §7) | Dashboard serveur/RLS avec agrégats EUR-only, portefeuille, échéances, actions et événements ; confirmé et `EN_TRAITEMENT` restent séparés. | 2 fichiers Vitest dashboard, 6/6. | Validation E2E avec données staging encore absente. | P0 | terminé |
| Paramètres | Profil, agent, règles et état Stripe configurables (02 §2bis/§3) | `/app/parametres` configure nom et profil agent par RPC auditée ; `/app/connexion-stripe` expose l’état réel. | SID-PROD-003 7/7 et tests actions/profil/Connect. | Les règles en langage naturel attendent l’agent de Phase 4. | P1 | partiel |
| Design system | Shell métier, sidebar/contenu/rail, tokens et patterns cohérents | App Shell responsive avec sidebar desktop, navigation mobile, contenu stable, rail sur dashboard/détail, focus et lien d’évitement. | Tests navigation et composants dashboard/Connect. | Theming sombre, audit visuel navigateur complet et homogénéisation des formulaires historiques restent en Phase 7. | P1 | partiel |
| Accessibilité | Clavier, focus, labels, annonces, contraste et responsive | Landmarks, labels et `role=alert` présents sur plusieurs formulaires. | Aucun test a11y. | Focus manquant sur plusieurs actions, cibles petites, `aria-current`/annonces async absents; contrastes mesurés sous 4,5:1 dans certains couples. | P1 | partiel |
| Observabilité | Logs structurés nettoyés, correlation ID, métriques/alertes paiement/IA/email (03 §8) | Logger serveur expurgé, UUID généré au Proxy et relié aux erreurs Auth/quota/webhook ; health strict avec attestation et no-store. | Tests logger, request ID, health, callback et webhook. | Métriques, alertes et instrumentation des futurs workers/IA/emails restent absentes. | P1 | partiel |
| Sécurité applicative | RLS, moindre privilège, CSP/headers, rate limits, entrées bornées, primitives de confiance (03 §6) | SID-SEC-002..006 fermés localement : DML probatoire retiré, approbations bornées, quotas persistants HMAC, cookies stricts, CSP/headers, routes sensibles privées et attestation de projet. | Schéma/RLS, Auth, Stripe, 21 tests SQL Phase 1 et tests HTTP/Vitest. | CSP nonce et purge planifiée des quotas restent P2 ; surfaces IA/email/workers seront sécurisées dans leurs phases. | P1 | partiel |
| Tests | Unitaires, SQL/RLS, intégration, Stripe, replay, concurrence et E2E staging (phase 8) | Scripts SQL/RLS/Stripe/sécurité/produit et 43 fichiers Vitest au contrôle intermédiaire Phase 2. | Reset complet, SID-PROD-002 14/14, SID-PROD-003 7/7 et Vitest 235/235 verts. | Aucun Playwright/CI, aucun parcours E2E staging, aucun Stripe test réel, aucun test agent/email/worker/a11y complet. | P0 | partiel |
| Déploiement Preview | Preview sur staging + Stripe test, logs et smoke tests (phase 9) | Preview Phase 0 `dpl_7icpMrMtMxZvTypLriponkedBPLF` vérifiée : health/base, accueil staging et Auth accessibles sous protection Vercel. | Smoke via `vercel curl`. | La configuration distante cible encore Preview+Production ensemble et ne fournit pas l’attestation staging ; aucune migration distante autorisée, prochain build attendu fail-closed. | P0 | bloqué par dépendance externe |
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
- écritures probatoires navigateur supprimées et décision humaine auditée,
  verrouillée et rejouable ;
- quotas Auth/callback/webhook persistants sans sujet brut ; cookies Auth serveur
  HttpOnly/Secure et routes sensibles non cachables ;
- attestation Supabase dédiée et sonde `service_role` requises hors local ;
- aucun secret réel détecté dans les fichiers suivis par la recherche ciblée.

Ces garanties locales ne valent pas validation Stripe test, staging ou Preview.

## Contrôles réellement exécutés pendant la Phase 0

| Commande | Résultat |
|---|---|
| `pnpm test` | Réussi après autorisation loopback : guard 54/54, schéma/RLS 33/33, Auth 38/38, PROD-001 50/50, Stripe 001 20/20, Stripe 002-A 12/12, Stripe 002-B 18/18, Stripe 002-C 12/12, Vitest 14 fichiers et 117/117 tests. |
| `pnpm typecheck` | Réussi. |
| `pnpm lint` | Réussi. |
| `pnpm build` | Réussi avec la configuration locale et Stripe désactivé; 15 routes générées. |
| Recherche de secrets | Aucun secret réel détecté; uniquement fixtures locales et placeholders de test. |
| Audit imports `service_role` | Usage limité aux modules serveur; aucune importation client détectée. |

Le premier lancement de `pnpm test` dans le sandbox a échoué sur `listen EPERM
127.0.0.1`; la même suite relancée avec l’autorisation loopback a réussi. Aucun
test n’a été masqué ni ignoré.

## Bloqueurs de bêta identifiés

1. Connect est actionnable localement mais n’a pas été validé avec un vrai
   compte Connect Stripe test.
2. L’identité PaymentIntent/session/tentative doit être recoupée strictement avant
   toute exposition à de vrais paiements.
3. Les autorisations futures et la réconciliation financière sont implantées
   localement (SID-STRIPE-003 / SID-PROD-004) mais **aucune migration distante
   n’a été appliquée** ; SEPA off-session reste fail-closed sans prénotification
   validée ; staging Stripe test requis avant bêta.
4. Agent Sidian, emails, workers et réconciliation financière sont absents.
5. Les messages et règles n’ont pas encore leurs services déterministes ; les
   approbations et dossiers disposent désormais de commandes/UI bornées.
6. Aucun E2E ni staging aligné n’est disponible ; la Preview Phase 0 est
   vérifiable mais la nouvelle attestation fail-closed n’est pas configurée.
7. Le traitement d’une contestation bancaire après `CLOS` est contradictoire
   entre l’architecture V2 §2.4 et §5.1bis ; ce seul sous-lot est arrêté dans
   l’attente d’une décision autoritative.

## Réserves documentaires

- La tarification Early Access est contradictoire entre le PRD V2 (49 € HT,
  20 premiers comptes, maintien 12 mois) et l’architecture V2 (`early_solo`,
  30 premiers comptes, verrouillage à vie). Le sous-lot de configuration de la
  tarification reste bloqué jusqu’à une décision autoritative ; aucun choix
  implicite n’a été implémenté.
- `PRE_DEPLOYMENT_CHECKLIST.md` et certains documents d’implémentation contiennent
  des compteurs ou états devenus obsolètes.
- `PAYMENTS_RUNBOOK.md` décrit par endroits des workers, pauses litige,
  remboursements ou transitions manuelles qui ne sont pas implémentés.
- `SIDIAN_UI_PATTERNS.md` conserve quelques libellés historiques « Contrats » ; le
  vocabulaire V2 « Paiements à recevoir » prime.
- Le lot 002-C était extérieur au HEAD initial audité ; son intégration ultérieure
  est isolée dans `69668c2` et ne modifie pas ce constat historique.

## Décision de passage

La Phase 0 est terminée : l’état est cartographié et les écarts sont priorisés.
Le produit reste **NOT READY** pour une bêta privée tant que les P0 ci-dessus ne
sont pas traités et démontrés en staging/Preview. Aucun environnement Production
n’a été consulté ou modifié.
