<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sidian V2 — Instructions agents

## Changement de modèle (14 juillet 2026)

Le produit repart d'un modèle entièrement nouveau. Ne jamais déduire de règle métier, produit ou d'architecture depuis `docs/archive/legacy-v1/LEGACY_SIDIAN_CURSOR_UPDATED_V1_DO_NOT_USE.md`.

Concepts abandonnés : enrôlement obligatoire, séquence J+0 à J+17, contrat central, grille Starter/Pro/Business, paiement automatique avant le premier règlement volontaire.

## Hiérarchie documentaire

Avant toute modification produit, paiement ou intégration, lire dans cet ordre :

1. `docs/SIDIAN_01_FONDATIONS_V2.md` — vision, ICP, principes fondateurs, contraintes légales.
2. `docs/SIDIAN_02_PRD_V2.md` — parcours utilisateur, rôle de l'agent, stratégie de paiement, périmètre MVP.
3. `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` — modèle de données, machines d'état, intégrations, workers.
4. `docs/SIDIAN_DESIGN_SYSTEM.md` + `docs/SIDIAN_UI_PATTERNS.md` — à lire ensemble pour tout travail d'interface.
5. `docs/operations/` — runbooks et checklists opérationnels.

## Résolution de contradictions

- Les trois documents V2 (01, 02, 03) font autorité fonctionnelle et technique.
- Sens métier : 01 (pourquoi) prime sur 02 (comment produit), qui prime sur 03 pour les choix produit ; 03 prime sur 02 pour l'implémentation technique.
- `README.md` et `docs/operations/` orientent et opérationnalisent — ils ne contredisent pas les V2.
- Le fichier legacy est strictement historique : aucune règle active ne s'en déduit.

## Méthode de tri du code antérieur au 14 juillet 2026

Avant réutilisation de code existant :

- **Dépend de l'ancien modèle** (enrôlement obligatoire, `mission_status`, séquence J0/J5/J9/J10, contrat central, grille Starter/Pro/Business) → réécrire.
- **Neutre** (auth, design system, infra générique) → peut être conservé après revue.
- En cas de doute, privilégier la réécriture alignée sur les documents V2.

## Règles de sécurité (non négociables)

- Aucune donnée de carte ou d'IBAN brute stockée — références Stripe uniquement.
- RLS activée sur toutes les tables `prestataire`-scopées.
- Aucune écriture directe d'un modèle IA dans Stripe ou Supabase — toute action passe par une fonction métier déterministe.
- Toute action sensible est tracée dans `audit_log` et peut nécessiter une `approval_request`.

Détail : `docs/SIDIAN_01_FONDATIONS_V2.md` §4, `docs/SIDIAN_03_ARCHITECTURE_TECHNIQUE_V2.md` §4 et §6.
