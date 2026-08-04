# SIDIAN_CONVERSATIONAL_UX.md

Règles d’expérience pour l’interface conversationnelle Sidian (assistant de travail).

Source complémentaire : `SIDIAN_DESIGN_SYSTEM.md` (tokens) + `SIDIAN_UI_PATTERNS.md` (shell métier classique). Ce document prime pour la surface `/app/assistant`.

---

## 1. Intent

L’assistant n’est pas un dashboard SaaS. Il doit se sentir :

- premium et calme ;
- centré sur la discussion ;
- contextuel seulement quand un dossier concret est actif.

---

## 2. Accueil

- L’état d’accueil est visible **uniquement** lorsque la conversation est vide.
- Condition : `messages.length === 0 && !isGenerating && activeContext === null`.
- Contenu : salutation, résumé court du jour, 3 suggestions d’accueil.
- Pas de grande carte, pas de widgets, pas de mascotte 3D.
- Après le **premier message** :
  - le titre disparaît ;
  - le résumé disparaît ;
  - les raccourcis d’accueil disparaissent ;
  - le fil remonte et occupe la hauteur disponible.
- Animation : fade + collapse vertical (~160–200 ms), avec respect de `prefers-reduced-motion`.

---

## 3. Panneau contextuel

- Masqué par défaut : `isContextPanelOpen = false`.
- Aucune zone vide réservée quand le panneau est fermé.
- Aucun état « Aucun sujet actif ».
- Ouverture uniquement si un contexte métier concret existe :
  - protection en cours de création ;
  - protection sélectionnée ;
  - paiement en analyse ;
  - client consulté depuis la conversation.
- Condition : `activeContext !== null && activeContext.type !== "none"`.
- Fermeture manuelle possible ; le panneau **ne se rouvre pas tout seul** après fermeture, sauf nouveau contexte explicite.
- Animation desktop : slide depuis la droite (~180–220 ms).
- Largeur recommandée : 360–420 px.
- Contenu simple : client, statut, montant, objet, échéance, prochaine étape, CTA.
- Édition au survol / clic ; pas d’icônes répétées ni de cadres imbriqués.

---

## 4. Discussion pleine largeur

- Sans panneau : la discussion prend toute la largeur restante après la sidebar.
- Le fil et le compositeur sont centrés dans une colonne lisible (`max-width` ~880–980 px).
- Avec panneau : la discussion se réduit progressivement ; pas de gap entre discussion et panneau.
- Aucune bordure autour de toute la discussion.
- Seule la sidebar possède une bordure droite permanente.
- Le panneau ajoute une séparation verticale discrète à gauche.

---

## 5. Raccourcis sous le compositeur

Composant dédié : `ComposerShortcuts`.

- Persistants pendant la conversation (distincts des suggestions d’accueil).
- Maximum 3 sur desktop (4 seulement si l’espace le permet).
- Style calme : bordure légère, fond presque transparent.
- Un seul raccourci peut porter un accent Sidian subtil.
- Changent selon le contexte :
  - défaut : créer une protection / voir les paiements / ajouter une facture ;
  - brouillon : modifier montant / échéance / contact ;
  - après création : voir la protection / autre facture / marquer payé.
- Masquables pendant la génération.
- Ne remplacent jamais la saisie libre.
- Mobile : défilement horizontal.

---

## 6. Responsive

### Desktop

- Sidebar visible.
- Panneau contextuel facultatif (inline).
- Chat centré, compositeur fixé en bas.

### Tablette

- Sidebar repliable.
- Panneau droit en overlay / drawer.
- Conversation prioritaire.

### Mobile

- Sidebar en drawer.
- Aucun panneau droit permanent.
- Contexte en bottom sheet ou écran dédié.
- Raccourcis en scroll horizontal.
- Accueil centré, compositeur fixé en bas.

---

## 7. Accessibilité

- Focus visible Sidian Blue / Ciel.
- Compositeur accessible clavier (Enter envoie, Shift+Enter nouvelle ligne).
- `prefers-reduced-motion` respecté pour accueil et panneau.
- Panneau et fil annoncés avec labels ARIA appropriés.

---

## 9. Direction visuelle premium (G1-O+)

Références : ChatGPT, Linear, Raycast, Arc, Apple HIG.

- Dark uniquement sur `/app/assistant` et `/dev/assistant`.
- Fond `#0B0B0C`, sidebar `#101113`, composer `#151618`, panel `#121315`.
- Espacements / hauteurs / rayons : **grille 4px uniquement** (pas de 2/6/10/14/18/22).
- Colonne de lecture centrée ~820px.
- Espacement messages **24px** ; contenu conversation **14px / 24px** ; titre welcome **28px** ; sous-titre **14px / 24px**.
- Noms message **12px / 600** ; labels panneau **12px uppercase** ; valeurs panneau **16px / 500**.
- Composer fermé **72px**, placeholder 14px.
- Bulles utilisateur `#18191C`, radius ~20px.
- Raccourcis = command chips sans bordure.
- Panneau protection = carte premium (Client / Montant / Échéance / Prochaine étape), CTA bas.
- Accent bleu uniquement CTA / focus / progression.


Route auth : `/app/assistant?demo=A|B|C|D|E`

Route preview locale (hors auth, jamais en prod sans flag) :

`/dev/assistant?demo=A|B|C|D|E`

Activation preview production-build locale uniquement :

`SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1`

| État | Attendu |
| --- | --- |
| A | Accueil, panneau fermé, chat large |
| B | Accueil disparu, panneau fermé |
| C | Panneau ouvert, raccourcis brouillon |
| D | Panneau fermé manuellement, conversation intacte |
| E | Protection active, raccourcis post-création |

## 10. Polish final

- Hero descendu (~64px) pour abaisser le centre de gravité ; composer remonté (`pb-10`).
- Accueil métier : « 3 650 € sont attendus aujourd’hui. »
- Command chips Raycast-like (fond discret, radius plein, hover 180ms, sans bordure).
- Focus composer : lueur Sidian Blue très douce (180ms).
- Logo : graisse bold, aligné sur le menu.
- Micro-animations 150–180ms, translate ≤ 8px.
- Largeurs sidebar / discussion / composer / panel **inchangées**.

