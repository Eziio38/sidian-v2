# SIDIAN — Documentation de l’agent

**Release :** SIDIAN Specification v1.0  
**Périmètre :** EPICU V1  
**Statut :** baseline normative verrouillée ; Gate documentaire G0 validé

## 1. Rôle du dossier

`docs/agent/` contient la source de vérité de l’agent Sidian : comportement, prompts, outils, mémoire, architecture agent et évaluations.

Les documents produit et techniques 01 à 03 restent en dehors de ce dossier. Lorsqu’un objet métier est défini dans le document 03, le document 08 le référence sans créer une seconde machine d’état.

## 2. Documents normatifs

| Fichier | Révision | Rôle |
|---|---:|---|
| `04_AGENT_CONSTITUTION.md` | 2.4 | Principes supérieurs, décision, autonomie et limites. |
| `05_AGENT_PROMPTS.md` | 1.3 | Architecture des prompts et génération batch. |
| `06_AGENT_TOOLS.md` | 1.0 | Contrats, permissions, exécution, idempotence et audit des outils. |
| `07_AGENT_MEMORY.md` | 1.0 | Catégories, provenance, portée, durée et suppression de la mémoire. |
| `08_AGENT_ARCHITECTURE.md` | 1.5 | Architecture logique, workflows, sécurité, observabilité et intégration produit. |
| `09_AGENT_EVALUATIONS.md` | 1.2 | Catalogue de 236 tests, preuves et gates. |

Ordre de priorité :

```text
04 Constitution
→ 05 Prompts
→ 06 Tools
→ 07 Memory
→ 08 Architecture
→ 09 Evaluations
→ implémentation
```

Un document inférieur peut préciser une règle supérieure, jamais l’affaiblir.

## 3. Documents de gouvernance

| Fichier | Fonction |
|---|---|
| `governance/REQUIREMENTS_MATRIX.md` | Traçabilité substantielle des 170 exigences vers 236 cas d’évaluation. |
| `governance/REVIEW_AND_RED_TEAM_REPORT.md` | Résultats de l’audit indépendant, contre-revue et corrections. |
| `governance/FINAL_DOCUMENTARY_GATE_REVIEW.md` | Verdict documentaire G0. |
| `governance/PACKAGE_VERIFICATION_REPORT.md` | Vérifications des versions, identifiants, liens et intégrité. |
| `governance/FINAL_MANIFEST.md` | Empreintes SHA-256 des fichiers du package. |

Les documents de gouvernance ne créent aucune règle produit ou permission.

## 4. État officiel

```text
Cohérence des documents 04–09 : PASS
Structure et intégrité du package : PASS
Traçabilité exigence → test : PASS
Tests exécutables G1–G6 : NOT EXECUTED
```

Le PASS concerne uniquement le référentiel documentaire G0. Il ne constitue pas une certification du code, du staging ou de la production.

## 5. Résultat de la revue de traçabilité

- exigences examinées : **170** ;
- exigences couvertes : **170** ;
- cas d’évaluation : **236** ;
- cas reliés à une ou plusieurs exigences atomiques : **232** ;
- contrôles transversaux explicitement justifiés : **4** ;
- tests orphelins non justifiés : **0** ;
- nouveaux cas ajoutés après analyse des lacunes : **16**.

## 6. Structure à conserver

```text
docs/
└── agent/
    ├── README.md
    ├── SIDIAN_SPECIFICATION_v1.0.md
    ├── 04_AGENT_CONSTITUTION.md
    ├── 05_AGENT_PROMPTS.md
    ├── 06_AGENT_TOOLS.md
    ├── 07_AGENT_MEMORY.md
    ├── 08_AGENT_ARCHITECTURE.md
    ├── 09_AGENT_EVALUATIONS.md
    └── governance/
        ├── REQUIREMENTS_MATRIX.md
        ├── REVIEW_AND_RED_TEAM_REPORT.md
        ├── FINAL_DOCUMENTARY_GATE_REVIEW.md
        ├── PACKAGE_VERIFICATION_REPORT.md
        └── FINAL_MANIFEST.md
```

## 7. Règle de modification

Toute modification normative doit mettre à jour :

- le document concerné et son journal de révision ;
- l’analyse d’impact sur les documents 04 à 09 ;
- la Requirements Matrix ;
- les tests concernés ;
- le Gate Review et le manifeste de la nouvelle release.

Git reste la source de l’historique. Les noms de fichiers actifs restent stables.
