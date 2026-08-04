/**
 * Candidats métier lus par les scanners — snapshot sans effets de bord.
 */

export type OpenCreanceSnapshot = {
  creanceId: string;
  prestataireId: string;
  clientPayeurId: string;
  dateEcheance: string;
  etat: "OUVERTE" | "PARTIELLEMENT_REGLEE";
  dossierSuiviId: string | null;
  dossierEtat:
    | "PREVENTION"
    | "ECHEANCE"
    | "SUIVI_AMIABLE"
    | "PAUSE_LITIGE"
    | "ATTENTE_CLIENT"
    | "ATTENTE_PRESTATAIRE"
    | "ESCALADE_HUMAINE"
    | "CLOS"
    | null;
  lastClientActivityAt: string | null;
  /** true si un lien partageable est déjà confirmé côté projection métier. */
  paymentLinkShareable: boolean;
  /** Autorisation ACTIVE + is_default pour auto-pay. */
  hasDefaultActiveAuthorization: boolean;
  /** Solde restant (centimes) > 0. */
  soldeRestantCents: number;
  /** Dossier en pause litige. */
  isPauseLitige: boolean;
  /** delai_grace (jours) depuis regle active, sinon null → défaut policy. */
  silenceGraceDaysFromRegle: number | null;
};

export type TerminalCreanceSnapshot = {
  creanceId: string;
  prestataireId: string;
  dateEcheance: string;
  etat: "REGLEE" | "ANNULEE" | "IRRECOUVRABLE";
  dossierSuiviId: string | null;
  dossierEtat:
    | "PREVENTION"
    | "ECHEANCE"
    | "SUIVI_AMIABLE"
    | "PAUSE_LITIGE"
    | "ATTENTE_CLIENT"
    | "ATTENTE_PRESTATAIRE"
    | "ESCALADE_HUMAINE"
    | "CLOS"
    | null;
};

export type FailedTentativeSnapshot = {
  tentativeId: string;
  creanceId: string;
  prestataireId: string;
  dossierSuiviId: string | null;
  etat: "ECHOUEE";
  failedAt: string;
};

export type ScannerCandidateSource = {
  listOpenCreances(): Promise<OpenCreanceSnapshot[]>;
  listTerminalCreances(): Promise<TerminalCreanceSnapshot[]>;
  listFailedTentatives(): Promise<FailedTentativeSnapshot[]>;
};
