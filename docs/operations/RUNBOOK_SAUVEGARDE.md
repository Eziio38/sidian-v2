# Runbook — sauvegarde et restauration

> **À jour au 5 août 2026.** Contrairement aux autres fichiers de ce dossier,
> celui-ci décrit le dépôt tel qu'il est aujourd'hui, pas le projet abandonné.
>
> **Contexte : le projet Supabase est en plan Free — il n'y a pas de PITR.**
> Le seul filet est celui que tu tends toi-même. Sans dump récent, une
> migration ratée est définitive.

---

## 1. Prendre une sauvegarde

```bash
SUPABASE_DB_URL="postgresql://…" node scripts/backup-supabase.mjs
```

La chaîne de connexion : **Supabase → Settings → Database → Connection string → URI**.
Elle contient le mot de passe de la base. Ne la colle jamais dans un chat, un
ticket ou un commit ; le script ne l'affiche nulle part et masque toute
occurrence dans les erreurs du CLI.

Résultat dans `backups/<horodatage>/` :

| Fichier | Contenu | Indispensable à la restauration |
|---|---|---|
| `roles.sql` | rôles du cluster | oui — sans eux les politiques RLS ne s'appliquent à personne |
| `schema.sql` | tables, contraintes, fonctions, RLS | oui |
| `data.sql` | contenu, en `COPY` | oui |

`backups/` est ignoré par git : ces fichiers contiennent des données
personnelles de débiteurs. Ne les dépose pas dans un dossier synchronisé
partagé.

---

## 2. Quand la prendre

**Avant chaque `supabase db push`.** Sans exception. C'est le seul moment où
tu détruis potentiellement des données de façon irréversible.

Rythme conseillé en plus de ça : une fois par semaine tant que le volume est
faible, quotidien dès les premiers clients réels.

> **Pourquoi pas une GitHub Action ?** Elle exigerait de déposer la chaîne de
> connexion de production dans les secrets du dépôt — donc de donner à la CI
> un accès administrateur permanent à la base. Sur un dépôt d'une personne,
> avec des actions épinglées par tag mutable (voir l'audit, P1-10), c'est un
> mauvais échange. Un lancement manuel avant chaque push, plus un rappel
> hebdomadaire, protège autant sans créer cette surface.

---

## 3. Restaurer

> **À répéter au moins une fois sur un projet jetable AVANT d'en avoir besoin.**
> Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est une
> supposition. Le jour de l'incident n'est pas le moment de découvrir qu'il
> manque un volet.

L'ordre compte. Rôles, puis schéma, puis données.

```bash
export TARGET="postgresql://…"   # projet de destination

psql "$TARGET" -f backups/<horodatage>/roles.sql
psql "$TARGET" -f backups/<horodatage>/schema.sql
psql "$TARGET" -f backups/<horodatage>/data.sql
```

Vérifications immédiates après restauration :

1. `select count(*) from public.prestataire;` — le compte correspond-il ?
2. La RLS est-elle bien active ? `pnpm test:schema` contre la cible restaurée.
3. Une connexion applicative réelle fonctionne-t-elle de bout en bout ?

Tant que ces trois points ne sont pas verts, considère la restauration comme
non terminée.

---

## 4. Répétition à blanc

À faire une fois, maintenant, pendant que l'enjeu est nul :

1. Créer un projet Supabase gratuit jetable.
2. Prendre une sauvegarde de la base actuelle.
3. La restaurer sur le projet jetable en suivant §3.
4. Faire tourner les trois vérifications.
5. Supprimer le projet jetable.

Note le temps que ça t'a pris. C'est ton objectif de reprise réel — pas celui
que tu imagines.

---

## 5. Ce que le plan Free ne te donnera pas

À savoir, pour ne pas se croire mieux protégé qu'on ne l'est :

- **Pas de PITR.** Tu ne peux pas revenir à « il y a trois heures ». Tu ne peux
  revenir qu'au dernier dump que tu as pris toi-même.
- **Pas de sauvegarde automatique exploitable.** Ce que tu perds, c'est tout ce
  qui s'est passé depuis ton dernier lancement du script.
- **Pas de rétention longue.** C'est ton disque, avec ta politique.

Le jour où de vrais clients arrivent, le plan Pro et son PITR cessent d'être un
confort. En attendant, ce runbook est ce qui tient lieu de filet.
