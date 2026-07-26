import { describe, expect, it } from "vitest";

import type { PermissionService } from "./permission-service";
import type { ToolRouter } from "./tool-router";

describe("G1-B interfaces", () => {
  it("exporte PermissionService et ToolRouter comme types", () => {
    const permissionProbe: PermissionService | null = null;
    const routerProbe: ToolRouter | null = null;
    expect(permissionProbe).toBeNull();
    expect(routerProbe).toBeNull();
  });
});
