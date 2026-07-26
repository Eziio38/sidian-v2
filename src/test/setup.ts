import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_STRIPE_PAYMENTS_ENABLED ??= "false";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* jsdom stub */
  };
}

afterEach(() => {
  cleanup();
});
