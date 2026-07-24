import { describe, expect, it } from "vitest";

import type { PermissionService } from "./interfaces/permission-service";
import type { ToolRouter } from "./interfaces/tool-router";

describe("G1-B interfaces only", () => {
  it("exporte PermissionService et ToolRouter comme types (pas d’implémentation)", () => {
    const permissionProbe: PermissionService | null = null;
    const routerProbe: ToolRouter | null = null;
    expect(permissionProbe).toBeNull();
    expect(routerProbe).toBeNull();
  });
});
