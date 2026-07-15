# SIDIAN — 01 · FONDATIONS (V2)
## Vision, connaissance de marché, psychologie, constitution produit

**Statut :** document de fondations pur. Ne contient aucune UX, aucun flow, aucune machine d'état — ces éléments vivent exclusivement dans 02 (PRD) et 03 (Architecture). Réécrit intégralement le 14 juillet 2026, remplace toute version antérieure.

**Méthode de classification — appliquée strictement à chaque affirmation de ce document :**
- **[FAIT CONFIRMÉ]** — preuve solide : recherche indépendante, documentation officielle, contrainte technique démontrée. Ne change que si une preuve contradictoire apparaît.
- **[PRINCIPE FONDATEUR]** — décision volontaire mais durable, au cœur de l'identité du produit. Peut changer, mais un changement ici doit être conscient et rare, pas un ajustement de routine.
- **[HYPOTHÈSE]** — supposition raisonnable, non prouvée. À valider en bêta.
- **[VALIDATION RESTANTE]** — sujet nécessitant un avis externe (juridique, réglementaire, Stripe, DSP2, RGPD, ACPR, fiscal) avant de pouvoir être traité comme acquis.

---

## 1. Vision

Sidian existe pour que le paiement B2B cesse d'être une décision répétée que quelqu'un doit prendre, et devienne un événement qui se produit par défaut. **[PRINCIPE FONDATEUR]**

Le produit ne vend pas une meilleure relance. Il vend la disparition de la question « est-ce que je vais être payé, et quand ». **[PRINCIPE FONDATEUR]**

---

## 2. Le problème — ce que la recherche établit

*(Synthèse condensée. Référence complète : `SIDIAN_RECHERCHE_MASTER_COMPLET_v1.md`, 7 rapports, ~40 sources croisées.)*

**Ampleur** **[FAIT CONFIRMÉ]**
- Retard moyen de paiement en France : 14,1 jours au S1 2025 ; 45,2 % seulement des organisations paient à l'heure (Altares).
- 53 à 58 % des freelances français rencontrent des difficultés de paiement rapide (Malt × BCG ; presse spécialisée).
- Un retard de plus d'un mois augmente d'environ 40 % la probabilité de défaillance de l'entreprise créancière (Banque de France).
- Jusqu'à 63 jours ouvrés par an consacrés à la relance manuelle (Intrum).

**Décomposition causale — le socle du raisonnement produit** **[FAIT CONFIRMÉ]**
- Tension de trésorerie du client : 45-49 % des cas cités (Atradius).
- Inefficacités de process interne : ~33 %.
- Litiges / contestations : ~29 %.
- Oubli pur : ~78 % des retards selon la FDCF (chiffre convergent avec le signal terrain FR, cité aussi par des acteurs de recouvrement) — traiter ce chiffre comme une estimation forte plutôt qu'une mesure indépendante répliquée, la méthodologie exacte de la FDCF n'a pas été vérifiée directement.
- Retard stratégique (le crédit fournisseur comme financement gratuit) : non isolé statistiquement, mais corrélé de façon nette à la taille du client payeur (20,6 jours de retard moyen pour les entreprises de plus de 1000 salariés contre 13 jours pour les 10-49 salariés — Altares).

**Le levier comportemental central** **[FAIT CONFIRMÉ]**
- L'inversion du défaut (le paiement se produit sans action plutôt que le retard sans action) est le mécanisme le plus puissant démontré par la littérature sur le biais du statu quo, et par les données de taux de succès du prélèvement automatique (97,3 % de succès au premier passage — GoCardless).
- La prévention avant échéance surpasse la relance après échéance : jusqu'à 40 % des impayés PME seraient évitables par une communication proactive avant la date due (Euler Hermes).
- La saillance simple d'un fait daté bat le ton, qui bat le canal (essais contrôlés en économie comportementale, jusqu'à +59 % de conformité pour un message dissuasif simple et clair).
- Le taux de recouvrement amiable chute de 26 % si la première relance intervient après J+30 (AFDCC).

**Psychologie des deux parties** **[FAIT CONFIRMÉ]** pour les mécanismes généraux, **[HYPOTHÈSE]** pour leur poids exact sur le segment freelance FR spécifique
- Le créancier (freelance) retarde sa propre relance par peur relationnelle, documentée comme disproportionnée par les praticiens, pas par négligence.
- Le payeur stratégique ne change de comportement que si un coût réel et certain apparaît ; un mécanisme automatique crée ce coût sans que le créancier ait à l'incarner personnellement.
- Les normes sociales ont un effet réel mais faible et contextuel — jamais à utiliser comme stratégie principale.

**Paysage concurrentiel** **[FAIT CONFIRMÉ]** sur le positionnement observé, **[HYPOTHÈSE]** sur les intentions futures des acteurs cités
- Aucun acteur observé (Upflow, Chaser, Kolleno, Paidnice, Pennylane, Tiime, Indy) ne combine aujourd'hui capture de moyen de paiement et débit automatique sur le segment freelance français.
- Cleavr.fr : positionnement de recouvrement automatisé par IA, avec autonomie complète jusqu'au contentieux (pilotage direct d'un réseau d'huissiers/avocats). Leur registre de communication de base est en réalité factuel et poli, pas agressif — la vraie différence avec Sidian est le niveau d'autonomie décisionnelle accordé à l'agent, pas le ton.
- Risque concurrentiel jugé le plus probable à moyen terme : GoCardless ou Stripe packageant une offre verticalisée freelance **[HYPOTHÈSE]**.

---

## 3. Profil utilisateur (ICP), promesse commerciale et jobs-to-be-done

**Cible principale — décision de lancement** **[DÉCISION DE LANCEMENT — hypothèse non encore validée par des clients payants réels, remplace l'ICP généraliste antérieur]**

Les micro-agences marketing B2B de 2 à 5 personnes qui facturent chaque mois des prestations récurrentes à 5 à 15 clients.

Métiers principalement visés : acquisition et publicité, SEO, growth, contenu, CRM et automatisation, agences IA orientées services.

Profil recherché :
- fondateur encore directement responsable des factures et des relances ;
- absence de DAF ou de credit manager ;
- prestations mensuelles récurrentes ;
- paiements à recevoir généralement compris entre 1 000 et 3 000 € ;
- clientèle principalement composée de PME privées ;
- au moins deux retards de paiement récents ;
- utilisation de Pennylane ou ouverture à une future connexion comptable ;
- volonté d'éviter les échanges gênants sur les règlements.

La cible compte entre 2 et 5 personnes, mais le MVP peut être utilisé par un seul opérateur principal : le fondateur responsable des règlements. Les fonctions équipe et les accès multi-utilisateurs ne sont pas nécessaires pour valider la proposition de valeur initiale (cf. 02 §2, 03 §1).

**Cible secondaire** **[DÉCISION DE LANCEMENT]**

Les consultants indépendants premium intervenant dans les mêmes métiers et disposant d'au moins cinq clients récurrents. Cette cible peut faciliter les premiers recrutements bêta et accélérer les retours terrain, mais elle ne dirige pas la communication principale du produit — celle-ci montre en priorité une agence et son fondateur, pas un freelance généraliste.

**Segments non ciblés au lancement** **[DÉCISION DE FOCUS, PAS UNE VÉRITÉ PERMANENTE SUR LE MARCHÉ]**

Sidian ne cible pas immédiatement : les agences de plus de 10 personnes, les ESN, les cabinets de conseil structurés, les SaaS, les entreprises travaillant principalement avec de grands groupes, les structures dont les paiements récurrents dépassent régulièrement 5 000 €.

Ces segments ne sont pas déclarés hors marché — ils sont reportés parce qu'ils demanderaient généralement plusieurs utilisateurs, des rôles et permissions, davantage de reporting, des workflows d'approbation internes, des capacités d'intégration plus poussées, et une gestion plus avancée des paiements élevés. C'est une décision de focus de lancement, à rouvrir une fois le mécanisme validé sur la cible principale.

**Promesse commerciale principale** **[DÉCISION]**

La promesse n'est pas « Automatisez votre recouvrement. » La promesse retenue est : **« Sidian suit les règlements de votre agence et évite que vous ayez à relancer personnellement vos clients. »**

Cette formulation reste cohérente avec les principes fondateurs : réduction de la charge mentale (P6), protection de la relation client (P2), prévention avant correction (P5), agent concierge plutôt que collecteur (P3), communication factuelle jamais agressive (P4). *(Ce document reste des fondations, pas une landing page — cette promesse est la seule référence commerciale conservée ici ; le wording détaillé vit ailleurs.)*

**Jobs-to-be-done principaux** **[HYPOTHÈSE — dérivée de la recherche terrain, pas d'interviews structurées propres à Sidian]**
1. « Je veux savoir, sans avoir à vérifier, que je vais être payé et quand. »
2. « Je ne veux plus être celui qui réclame à mon client. »
3. « Je ne veux pas choisir entre ma trésorerie et ma relation commerciale. »
4. « Je veux garder le contrôle sur les décisions qui comptent, sans avoir à gérer les décisions qui ne comptent pas. »

---

## 4. Contraintes légales, réglementaires et techniques

*Chaque contrainte est reclassée individuellement — aucune n'est traitée comme acquise par défaut.*

| Sujet | Statut | Formulation correcte |
|---|---|---|
| Plafond de paiement carte | **[HYPOTHÈSE OPÉRATIONNELLE]** | Les paiements B2B de montant élevé peuvent être refusés en raison de plafonds bancaires ou de contrôles antifraude — mais ces plafonds dépendent de la banque, de la carte, du titulaire, de la période et des contrôles antifraude, pas d'un seuil réseau universel. Le taux de réussite réel devra être mesuré en bêta par tranche de montant, pas présumé à l'avance. |
| SEPA B2B via Stripe | **[FAIT CONFIRMÉ]** | Non disponible dans l'infrastructure Stripe actuelle — vérifié, pas une supposition. |
| RGPD — enregistrement d'un moyen de paiement | **[VALIDATION RESTANTE]** | Le consentement n'est qu'une des six bases légales RGPD (article 6) ; il n'est pas systématiquement requis, un traitement pouvant reposer sur l'exécution du contrat ou l'intérêt légitime. Ce qui est certain : l'enregistrement et l'utilisation future d'un moyen de paiement doivent faire l'objet d'une information claire, d'une acceptation non ambiguë et d'une traçabilité adaptée. La base légale exacte et la forme précise de cette acceptation restent à valider pour le parcours définitif — ne pas parler par défaut d'une « case RGPD » systématique. |
| Statut ACPR / exemption agent PSP | **[VALIDATION RESTANTE]** | Architecture actuellement conçue pour rester dans le périmètre d'un prestataire technique n'exerçant aucune détention de fonds ni capacité de modification d'ordre de paiement. **Ceci n'a pas été confirmé par un avis juridique formel** — à valider avant tout lancement à l'échelle. |
| Commission Stripe Connect (`application_fee_amount`) | **[DÉCISION PRODUIT DÉJÀ ARBITRÉE, VALIDATION STRIPE RESTANTE]** | Le choix de capter la commission via ce mécanisme, avec le freelance comme merchant of record, est une décision produit cohérente avec l'architecture Stripe Connect en direct charge. Sa conformité fine (notamment le traitement de la commission en cas de litige/chargeback) reste à confirmer avec la documentation Stripe à jour et, si besoin, le support Stripe. |
| Réforme facturation électronique (PDP) | **[VALIDATION RESTANTE]** | Généralisation à partir de septembre 2026, avec obligation d'interopérabilité entre plateformes agréées. Le statut souhaité de Sidian vis-à-vis de ce réseau (agrément propre ou interfaçage avec un tiers déjà agréé) n'est pas tranché. |
| Agrégation bancaire (lecture de compte) | **[VALIDATION RESTANTE]** | Le principe (connexion en lecture seule via un prestataire agréé DSP2) est solide sur le papier, mais le choix du prestataire technique et la validation de conformité DSP2 exacte restent à faire. |
| Prescription des créances commerciales | **[VALIDATION RESTANTE — pour le régime de droit commun uniquement]** | Le délai de droit commun des créances B2B commerciales est de 5 ans (article L110-4 du Code de commerce, aligné depuis 2008 sur l'article 2224 du Code civil), à compter de l'exigibilité de la créance — pas 2 ans comme indiqué par erreur dans une version antérieure de ce document. Ce délai peut être raccourci par régime spécial ou par clause contractuelle explicite (jamais en-deçà d'un an). La politique de conservation exacte des données Sidian doit être validée juridiquement au regard de ce délai. |

---

## 5. Constitution produit — principes fondateurs

*Chacun de ces principes est une **[PRINCIPE FONDATEUR]** : une décision volontaire mais qui ne devrait pas changer au gré des itérations tactiques. Un changement ici doit être explicite et documenté comme tel, jamais implicite.*

**P1 — Inversion du défaut.** Toute décision produit est évaluée à l'aune d'une question : est-ce que ça rapproche le paiement de l'état « se produit sans action », ou l'en éloigne ?

**P2 — Un seul mandant.** Sidian sert le prestataire qui finance le produit. Le client final (le payeur) est traité avec soin parce que c'est la stratégie la plus efficace pour obtenir le paiement — jamais par obligation envers lui. En cas de conflit d'intérêt réel entre les deux parties, l'intérêt du prestataire tranche.

**P3 — L'agent est un concierge, pas un négociateur ni un collecteur.** Autorité déléguée large sur la communication, bornée sur tout ce qui touche à l'argent ou à l'engagement. Les décisions importantes et irréversibles restent humaines. Ce principe distingue explicitement Sidian de modèles comme Cleavr, dont l'agent négocie et pilote le contentieux en autonomie complète.

**P4 — La fermeté vient de la clarté, jamais de la pression.** Le registre de communication reste factuel et daté à tout moment. Jamais de moralisation, jamais de culpabilisation, jamais un ton susceptible de se requalifier en menace informelle.

**P5 — La prévention prime sur la correction.** Toute évolution produit doit chercher à déplacer l'intervention le plus tôt possible dans le cycle de vie de la créance.

**P6 — Réduire la charge mentale, jamais la déplacer.** Une fonctionnalité qui transfère une décision ou une action répétée vers le prestataire va contre la mission du produit, même si elle paraît utile isolément.

**P7 — Aucune fonctionnalité orientée client sans bénéfice mesurable pour le prestataire.** Le client ne finance pas le produit ; toute expérience qui lui est destinée doit être justifiée par un effet démontrable sur le taux de paiement, la réduction des contestations, ou l'adhésion au mécanisme.

**P8 — Sidian assume ce qu'il ne résout pas.** L'insolvabilité durable et les litiges de fond restent hors périmètre logiciel, et le produit le dit explicitement plutôt que de prétendre tout résoudre.

**P9 — Indépendance vis-à-vis des fournisseurs de modèles.** Les règles métier, les états, les permissions, les garde-fous et l'exécution des actions ne dépendent jamais du fournisseur d'intelligence artificielle utilisé pour générer une décision ou une communication. Le choix d'un fournisseur (aujourd'hui OpenAI, potentiellement un autre demain) est un détail d'implémentation, jamais une hypothèse structurante du produit.

**P10 — Parité d'autorité.** Tout assistant capable d'agir pour le compte de Sidian, natif ou externe, passe par les mêmes fonctions métier, les mêmes contrôles et la même traçabilité que n'importe quel autre. Aucun assistant n'obtient plus de droits qu'un autre du seul fait d'être un fournisseur différent. Ce principe n'implique aucune obligation de construire une intégration externe aujourd'hui — voir 03 §11 pour son traitement en backlog.

---

## 6. Ce qui est explicitement hors périmètre

**[PRINCIPE FONDATEUR]**
- Sidian n'émet pas de facture légale dans le MVP. Il reste volontairement découplé des outils de facturation afin de se concentrer sur le suivi et l'encaissement des paiements à recevoir. Une éventuelle évolution future sur ce sujet nécessiterait une décision produit, fiscale et réglementaire distincte — ce n'est pas une impossibilité juridique intrinsèque à un SaaS, c'est un choix de périmètre.
- Sidian ne pilote jamais seul une action contentieuse (mise en demeure, procédure judiciaire, transmission à un tiers de recouvrement) sans validation explicite du prestataire.
- Sidian ne traite pas l'insolvabilité durable comme un cas résoluble par le produit.
- Sidian ne construit pas de stratégie de communication reposant principalement sur les normes sociales ou la pression psychologique.

---

*Document 01 sur 3 — V2. Voir 02 · PRD et 03 · Architecture technique.*
