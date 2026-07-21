import { describe, expect, it } from "vitest";

import {
  publicPaymentRouteHeaders,
  publicPaymentRouteSource,
} from "../../../next.config";

import { metadata } from "./layout";

describe("sécurité des pages publiques /p/*", () => {
  it("désactive indexation et suivi au niveau du segment applicatif", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("impose no-store, no-referrer et X-Robots-Tag sur les réponses", () => {
    expect(publicPaymentRouteSource).toBe("/p/:path*");
    expect(publicPaymentRouteHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Cache-Control", value: expect.stringContaining("no-store") }),
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );
  });
});
