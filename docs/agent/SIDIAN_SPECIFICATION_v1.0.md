# SIDIAN SPECIFICATION v1.0

**Statut :** baseline normative verrouillée ; Gate documentaire G0 validé  
**Périmètre :** SIDIAN Agent — EPICU V1  
**Documents normatifs :** 04 à 09

# 1 — Déclaration

Cette release regroupe les six documents normatifs de l’agent Sidian sous une baseline commune :

```text
SIDIAN Specification v1.0
```

Elle fournit la source de vérité pour l’implémentation, les contrôles de sécurité, les workflows, la mémoire et les évaluations.

# 2 — Contenu normatif

| ID | Fichier | Révision | Statut |
|---|---|---:|---|
| 04 | `04_AGENT_CONSTITUTION.md` | 2.4 | Locked |
| 05 | `05_AGENT_PROMPTS.md` | 1.3 | Locked |
| 06 | `06_AGENT_TOOLS.md` | 1.0 | Locked |
| 07 | `07_AGENT_MEMORY.md` | 1.0 | Locked |
| 08 | `08_AGENT_ARCHITECTURE.md` | 1.5 | Locked |
| 09 | `09_AGENT_EVALUATIONS.md` | 1.2 | Locked |

# 3 — Hiérarchie

```text
04 → 05 → 06 → 07 → 08 → 09 → implémentation
```

La Constitution prévaut. Une implémentation contradictoire est un défaut. Une absence de documentation ne crée ni permission ni règle métier.

# 4 — Articulation avec les documents 01 à 03

Les documents 01 à 03 définissent les fondations, le produit et l’architecture technique métier. Les documents 04 à 09 définissent l’agent.

En cas de modèle métier déjà défini dans le document 03, le document 08 doit le référencer et ne peut pas créer un second cycle de vie concurrent. C’est notamment le cas du concept fonctionnel d’enrollment, aligné sur `payment_authorization`.

# 5 — Invariants principaux

- un texte ou une préférence ne crée jamais une permission ;
- le LLM propose, le système autorise et les outils exécutent ;
- les effets de bord passent par des outils contrôlés ;
- les décisions significatives respectent les niveaux d’autonomie de la Constitution ;
- les données, caches, jobs et mémoires restent isolés par tenant ;
- un résultat financier incertain déclenche une réconciliation, jamais un retry aveugle ;
- la mémoire ne remplace jamais l’état métier autoritatif ;
- toute action significative est explicable et traçable ;
- les workflows planifiés restent déterministes et indépendants de la disponibilité du LLM.

# 6 — Statut des gates

```text
G0-A — cohérence documentaire 04–09 : PASS
G0-B — intégrité structurelle du package : PASS
G0-C — traçabilité substantielle exigence → test : PASS
G1 à G6 — implémentation et preuves runtime : NOT EXECUTED
```

# 7 — Résultat de la revue de traçabilité

La Requirements Matrix v1.2 a été revue exigence par exigence contre le catalogue d’évaluation.

Résultat :

- **170 exigences couvertes** ;
- **236 cas Blocking** ;
- **16 nouveaux cas** ajoutés pour fermer les lacunes du catalogue v1.1 ;
- **232 cas** reliés à une ou plusieurs exigences atomiques ;
- **4 contrôles transversaux** explicitement justifiés ;
- **0 test orphelin non justifié** ;
- **0 exigence non couverte** au niveau documentaire.

# 8 — Limites du verdict

Le Gate G0 certifie la cohérence et la traçabilité du référentiel documentaire. Il ne certifie pas :

- l’implémentation du code ;
- l’application des migrations ;
- l’exécution des tests ;
- le staging ;
- la production ;
- la conformité juridique ou réglementaire.

Ces preuves relèvent des gates G1 à G6.

# 9 — Versioning

- `v1.0.x` : corrections non normatives et métadonnées ;
- `v1.1` : ajout rétrocompatible ou clarification normative limitée ;
- `v2.0` : modification majeure des permissions, de l’autonomie, de l’isolation, du modèle financier ou des frontières d’architecture.

Les révisions internes des documents restent distinctes de la version globale de la spécification.

# 10 — Verdict de release

SIDIAN Specification v1.0 est la baseline normative officielle à utiliser pour développer l’agent.

```text
Documentary Gate G0: PASSED
Runtime Gates G1–G6: NOT EXECUTED
```
