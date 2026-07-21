# Phase 2 — cœur produit prestataire

Date de validation locale : **21 juillet 2026**

Branche : **`develop`**

Statut : **terminée localement pour les sous-lots non conflictuels ; le litige
bancaire tardif reste bloqué par une contradiction V2 et la validation Stripe
test/Preview reste externe**.

## Parcours livré

- Le profil prestataire est configurable par une RPC tenant-safe qui dérive
  l’identité du JWT, verrouille la ligne, borne le nom, enregistre le profil
  agent et audite seulement les changements réels.
- Le parcours « Bien démarrer » suit la séquence du PRD : profil, premier
  client, premier paiement à recevoir, puis Stripe au moment contextuellement
  utile. Stripe n’est jamais un prérequis à la création du premier paiement.
- La connexion Stripe Express est actionnable depuis le produit. L’état affiché
  est relu en direct chez Stripe, le compte est réconcilié avant usage et aucun
  détail KYC ou identifiant Stripe n’est transmis au composant client.
- Le dashboard distingue strictement le solde à recevoir, les paiements
  confirmés, les tentatives en traitement, les échéances, les litiges, les
  décisions humaines et les événements récents. Toute devise autre que EUR
  invalide l’agrégation au lieu d’être convertie silencieusement.
- Chaque paiement à recevoir possède une vue détaillée avec montant total,
  confirmé, en traitement, solde restant, échéance, état financier et
  historique expurgé des identifiants techniques.
- Le dossier de suivi est créé et transitionné par des commandes SQL
  déterministes, tenant-scopées, verrouillées, auditées et idempotentes. Son
  état reste distinct de l’état financier.
- L’annulation est une commande serveur atomique. Elle refuse les brouillons,
  paiements partiels/confirmés et tentatives Stripe non terminales, puis révoque
  le lien et clôt le dossier sans supprimer l’historique. Avant cette commande,
  le serveur relit chaque Session Checkout connue dans son compte Connect,
  expire celles encore ouvertes et refuse fermé tout résultat ambigu.
- L’archivage est réservé aux brouillons et états financiers terminaux. Il ne
  peut plus masquer une situation ouverte, partiellement réglée ou en litige ni
  contourner l’annulation sûre.
- Les demandes d’approbation sont lisibles et décidables dans l’interface via
  la RPC humaine Phase 1. L’identité et le tenant ne viennent jamais du
  formulaire. Une approbation enregistre une décision auditée ; elle ne modifie
  aucun solde à elle seule.
- L’App Shell fournit une navigation desktop/mobile cohérente, un lien
  d’évitement, `aria-current`, un état de chargement et une erreur récupérable.

## Décision « réglé hors Sidian »

Le brief de Phase 2 demandait de gérer ce cas « lorsque le PRD l’autorise ».
Le PRD V2 §4.6 et §8 dit explicitement qu’un virement hors Sidian n’est pas
couvert au MVP et passe inaperçu du produit. Aucune commande manuelle, aucun
paiement `detecte_hors_sidian` et aucune mutation financière correspondante
n’ont donc été ajoutés. Cette exclusion est testée dans SID-PROD-002.

## Migrations additives

- `20260721210000_sid_prod_002_core_workflows.sql`
- `20260721210100_sid_prod_003_profile_onboarding.sql`
- `20260721210200_sid_prod_002_p1_state_guards.sql`

Aucune migration préexistante ou déjà appliquée avant cette phase n’a été
modifiée. Les types Supabase ont été régénérés après le reset local complet.

## Invariants démontrés

- ordre de verrouillage annulation : créance → lien → tentative → dossier ;
- aucune annulation si Stripe traite encore une tentative ;
- aucune annulation tant que Stripe live ne prouve pas chaque Session Checkout
  connue expirée et impayée ;
- aucun paiement confirmé supprimé ou réécrit ;
- aucun archivage d’un état actif ou partiellement réglé ;
- lien actif révoqué et dossier clos dans la même transaction ;
- état financier terminal → seule clôture du dossier ; `CLOS` reste terminal ;
- replay sans nouvel audit ni nouveau dossier ;
- RLS et DML navigateur fermés ;
- fonctions `SECURITY DEFINER` avec `search_path` explicite et ACL étroites ;
- aucune donnée financière calculée à partir d’un retour ou d’un formulaire
  navigateur ;
- Stripe live reste l’autorité avant Account Link et avant encaissement ;
- dashboard et détail EUR uniquement, sans mélange confirmé/en traitement.

## Tests dédiés

- `scripts/test-sid-prod-002.mjs` : dossiers, annulation, verrouillage, replay,
  isolation tenant, absence de règlement hors Sidian ;
- `scripts/test-sid-prod-003.mjs` : profil, JWT, ACL, audit et idempotence ;
- `scripts/test-sid-prod-002-p1-state-guards.mjs` : archivage sûr, états
  terminaux, replay et isolation tenant ;
- tests Vitest dashboard, Connect, profil, onboarding, approbations, détail,
  transitions, schémas et actions serveur.

## Validation locale finale

| Contrôle | Résultat |
|---|---|
| `pnpm test` | Réussi : schéma/RLS 33/33, Auth 38/38, PROD-001 50/50, PROD-002 14/14, garde-fous P1 8/8, PROD-003 7/7, Stripe 001 20/20, Stripe 002-A 12/12, Stripe 002-B 18/18, Stripe 002-C 12/12, sécurité et 45 fichiers Vitest / 248 tests. |
| `pnpm typecheck` | Réussi. |
| `pnpm lint` | Réussi sans avertissement. |
| `pnpm build` | Réussi avec Next.js 16.2.10 ; 21 pages générées et 23 routes recensées. |
| `git diff --check` | Réussi. |

Le reset Supabase local complet a appliqué toutes les migrations, dont les deux
migrations additives de cette phase, avant la régénération des types.

## Réserves et dépendances de phase

- **Sous-lot litige tardif bloqué.** Le PRD V2 §4.4 et l’architecture V2
  §5.1bis imposent de placer le dossier en `ESCALADE_HUMAINE` lors d’une
  contestation bancaire d’un paiement confirmé. L’architecture V2 §2.4 impose
  simultanément que `CLOS` soit terminal, sans transition
  `CLOS → ESCALADE_HUMAINE`. Une contestation pouvant survenir après la clôture,
  les documents ne déterminent pas s’il faut rouvrir exceptionnellement le
  dossier ou porter l’incident dans un objet séparé. Ce choix sécurité/financier
  n’a pas été arbitré dans le code ; audit et approbation durables existants sont
  conservés, mais la suspension complète reste un P1 ouvert.
- Le sous-lot tarification reste volontairement non implémenté : le PRD V2
  (§5.1) définit 49 € HT/mois, 20 premiers comptes et un prix maintenu 12 mois,
  tandis que l’architecture V2 (§2, `prestataire`) définit `early_solo`, les 30
  premiers comptes et un verrouillage à vie. Conformément à la règle de
  résolution des contradictions, aucune de ces variantes n’a été choisie sans
  décision documentaire autoritative.
- Aucun vrai compte Stripe Connect test ni Account Link hébergé n’a été parcouru
  dans cette phase. Cette preuve requiert un staging correctement attesté.
- Une Session ou un PaymentIntent en vol doit être terminalisé ou réconcilié
  avec Stripe avant l’annulation ; le refus fermé est volontaire.
- Les règles en langage naturel, conversations réelles et exécution des actions
  approuvées appartiennent à la Phase 4 (agent Sidian).
- L’envoi actif du premier lien, les relances et notifications appartiennent à
  la Phase 5 (emails/workers). L’onboarding ne prétend donc pas encore que le
  premier envoi a eu lieu.
- La création d’une autorisation de paiement future reste à construire dans la
  Phase 3 ; aucune capacité future n’est simulée ici.
- Le staging/Preview reste fail-closed tant que l’attestation et les credentials
  dédiés ne sont pas installés manuellement.
