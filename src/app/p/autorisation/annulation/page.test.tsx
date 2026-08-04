import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AuthorizationCancelPage from "./page";

describe("AuthorizationCancelPage", () => {
  it("n'infère aucun état d'autorisation depuis le retour navigateur", () => {
    render(<AuthorizationCancelPage />);
    expect(screen.getByText(/ne modifie aucune autorisation/i)).toBeVisible();
    expect(screen.getByText(/vérification serveur de l’état réel/i)).toBeVisible();
    expect(screen.queryByText(/autorisation refusée/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/autorisation annulée/i)).not.toBeInTheDocument();
  });
});
