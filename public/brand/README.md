# Brand assets Sidian — interim

**Statut :** assets **intérimaires** pour le MVP / gate UI (2026-07-26).

## Contenu

| Fichier | Usage |
| --- | --- |
| `sidian-mark-blue.svg` | Mark principal — Sidian Blue `#3B6DF8` (tous fonds, y compris Nuit) |
| `sidian-mark-white.svg` | Variante blanche si le bleu est illisible (photo / fond chargé) |

Le wordmark « Sidian » n’est **pas** une image : toujours du texte Outfit ExtraBold (800), letter-spacing `-0.02em` — cf. `docs/SIDIAN_DESIGN_SYSTEM.md` §1.

## Pourquoi SVG et non PNG DS

Les PNG officiels (`sidian-mark-blue.png` / `sidian-mark-white.png`, 156 px) et la source vectorielle finale **ne sont pas encore dans le dépôt**. Ces SVG reproduisent l’entrelacs (deux boucles liées) pour que les lockups (`BrandLockup`, auth) ne 404 plus.

## Remplacement prévu

1. Déposer les PNG DS détourés (fond transparent, 156 px) dans ce dossier.
2. Pointer `BrandLockup` / auth vers les PNG.
3. Retirer ou archiver ces SVG interim.

Ne pas inventer d’autres variantes hors design system.
