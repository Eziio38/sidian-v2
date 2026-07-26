# SID_GATE_G1O_EVIDENCE — Conversational UI (layout simplification)

**Decision:** PASS  
**Route (auth):** `/app/assistant` (+ `?demo=A|B|C|D|E`)  
**Route preview locale :** `/dev/assistant` (+ `?demo=A|B|C|D|E`)  
**SHA reference:** workspace local (uncommitted UI pass)

---

## Welcome behavior

- Welcome visible only when `messages.length === 0 && !isGenerating && activeContext === null`.
- Disappears after first user message (unmount + entry fade ~180 ms).
- No cards / widgets / 3D mascot.
- Demo A shows welcome ; demos B–E hide it (verified in browser).

## Context panel behavior

- Default: closed (`isContextPanelOpen = false`).
- No empty “Aucun sujet actif” placeholder (verified : `aucunSujet=false` sur A→E).
- No reserved width when closed — discussion uses full remaining width.
- Opens only with concrete `activeContext` (draft / protection).
- Manual close remembered via `dismissedContextId` (demo D).
- Desktop inline ; mobile bottom sheet (no permanent right rail).

## Composer shortcuts

- Dedicated `ComposerShortcuts` under the composer.
- Persist during conversation ; change by phase (`default` / `draft` / `created`).
- Max 3 shortcuts ; light border ; one subtle primary emphasis.

## Responsive

- Desktop: sidebar + optional inline panel + centered chat column.
- Tablet: collapsible sidebar + overlay panel.
- Mobile: drawer sidebar + sheet context ; horizontal shortcut scroll.

## Accessibility

- Keyboard composer (Enter submit).
- Focus rings.
- `prefers-reduced-motion` for welcome/panel entrance.
- ARIA labels on panel / shortcuts / composer.

## Tests

```
pnpm test:g1-o
# → 11 passed
```

## Visual verification

Vérification navigateur Playwright sur serveur local `next start` (port **3050**).

| État | Welcome | Panneau | `data-panel-open` | Raccourcis | Aucun sujet |
| --- | --- | --- | --- | --- | --- |
| A | oui | non | false | défaut | non |
| B | non | non | false | défaut | non |
| C | non | oui | true | brouillon | non |
| D | non | non | false | brouillon | non |
| E | non | oui | true | post-création | non |

Contrôles UX observés sur captures :

- pas de bordure autour de toute la discussion ;
- bordure droite permanente uniquement sur la sidebar ;
- hauteur complète (`h-dvh`) ;
- compositeur fixé en bas ;
- colonne de lecture centrée (~960px sans panneau) ;
- pas de zone vide réservée quand panneau fermé ;
- sidebar sombre premium + contenu clair calme ;
- mobile exploitable (sheet contexte).

## Local command

```bash
# Preview hors auth (local uniquement)
SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1 pnpm build
SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1 pnpm exec next start --hostname 127.0.0.1 --port 3050

# Alternative dev (si aucun autre next lock)
pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3020
```

Sans le flag / hors development : `/dev/assistant` → `404` (`notFound()`).  
`/app/assistant` reste protégé par session confirmée (redirect `/connexion`).

## Local URL

`http://127.0.0.1:3050/dev/assistant` (session de preuve)

## Demo URLs

- A: http://127.0.0.1:3050/dev/assistant?demo=A
- B: http://127.0.0.1:3050/dev/assistant?demo=B
- C: http://127.0.0.1:3050/dev/assistant?demo=C
- D: http://127.0.0.1:3050/dev/assistant?demo=D
- E: http://127.0.0.1:3050/dev/assistant?demo=E
- Mobile: http://127.0.0.1:3050/dev/assistant?demo=C&viewport=mobile

(Équivalents auth : `/app/assistant?demo=…` après connexion.)

## Screenshots

- `docs/implementation/evidence/g1-o-state-a-desktop.png`
- `docs/implementation/evidence/g1-o-state-b-desktop.png`
- `docs/implementation/evidence/g1-o-state-c-desktop.png`
- `docs/implementation/evidence/g1-o-state-d-desktop.png`
- `docs/implementation/evidence/g1-o-state-e-desktop.png`
- `docs/implementation/evidence/g1-o-mobile.png`

Thème clair du contenu central = mode officiel de cette gate (sidebar sombre + surface blanche). Pas de second thème clair alternatif à capturer.

## Desktop result

PASS — états A→E conformes aux critères UX ; panneau conditionnel ; pas de gap ; raccourcis contextuels.

## Mobile result

PASS — pas de panneau permanent ; contexte en bottom sheet ; header menu + conversation lisible.

## Known visual defects

- Non bloquant : bruit console Playwright `ERR_SSL_PROTOCOL_ERROR` (hors app).
- Non bloquant : lien nav « Historique » → `/app/demarrage` (placeholder).
- Non bloquant : disparition welcome = unmount (pas de fade-out de sortie).
- Hors scope : pas de wire LLM live / `/api/agent/tools` dans cette passe UI.

## Final decision

**PASS**

Preuves : route preview accessible, captures A→E + mobile présentes, critères UX validés, aucun défaut visuel bloquant.

## Limitations

- UI shell only: no live LLM provider wiring (G1-N stub remains backend).
- Message send uses a local demo reply.
- Preview `/dev/assistant` gated by `NODE_ENV !== production` **ou** `SIDIAN_ALLOW_DEV_ASSISTANT_PREVIEW=1` — jamais exposée en déploiement sans flag explicite.
- No automatic commit.

## Files

- `src/components/assistant/**`
- `src/app/app/assistant/page.tsx`
- `src/app/dev/assistant/page.tsx`
- `docs/design/SIDIAN_CONVERSATIONAL_UX.md`
- `docs/implementation/evidence/g1-o-*.png`
- `src/app/globals.css`
