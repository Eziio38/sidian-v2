import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceNameDialog } from "./workspace-name-dialog";

describe("WorkspaceNameDialog", () => {
  it("réinitialise le nom à chaque ouverture et lors d’un nouveau préremplissage", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const view = render(
      <WorkspaceNameDialog
        open={false}
        title="Renommer"
        initialValue="Alpha"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByTestId("workspace-name-dialog")).not.toBeInTheDocument();

    view.rerender(
      <WorkspaceNameDialog
        open
        title="Renommer"
        initialValue="Alpha"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByTestId("workspace-name-dialog-input");
    expect(input).toHaveValue("Alpha");
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "Brouillon");

    view.rerender(
      <WorkspaceNameDialog
        open={false}
        title="Renommer"
        initialValue="Alpha"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    view.rerender(
      <WorkspaceNameDialog
        open
        title="Renommer"
        initialValue="Alpha"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("workspace-name-dialog-input")).toHaveValue(
      "Alpha",
    );

    view.rerender(
      <WorkspaceNameDialog
        open
        title="Renommer"
        initialValue="Beta"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("workspace-name-dialog-input")).toHaveValue(
      "Beta",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
