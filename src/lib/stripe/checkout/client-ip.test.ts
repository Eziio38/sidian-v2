import { describe, expect, it } from "vitest";

import { clientIpFromHeaders } from "@/lib/stripe/checkout/client-ip";

describe("clientIpFromHeaders", () => {
  it("ignore le premier X-Forwarded-For contrôlable et préfère l'en-tête Vercel", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.99, 10.0.0.1",
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-real-ip": "203.0.113.8",
    });

    expect(clientIpFromHeaders(headers, true)).toBe("203.0.113.7");
  });

  it("utilise un repli déterministe sans en-tête de plateforme fiable", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.99",
    });

    expect(clientIpFromHeaders(headers, true)).toBe("untrusted-proxy");
  });
});
