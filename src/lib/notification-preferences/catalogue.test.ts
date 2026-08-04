import { describe, expect, it } from "vitest";

import { EMAIL_TEMPLATE_KEYS } from "@/lib/email/types";

import {
  auditEmailTemplateCoverage,
  NON_EMITTED_EMAIL_TEMPLATES,
  NOTIFICATION_EVENTS,
  readNotificationPreferencesFromFormData,
  toNotificationPreferences,
} from "./catalogue";

describe("catalogue des notifications réglables", () => {
  it("classe chaque gabarit déclaré, sans doublon", () => {
    // Le jour où un gabarit est ajouté à EMAIL_TEMPLATE_KEYS, ce test tombe :
    // il faut alors décider s'il est émis (donc réglable) ou non, plutôt que
    // de le laisser silencieusement hors du catalogue.
    expect(auditEmailTemplateCoverage()).toEqual({
      missing: [],
      duplicated: [],
    });
  });

  it("n’expose que les deux gabarits réellement émis par le runtime", () => {
    expect(NOTIFICATION_EVENTS.map((event) => event.templateKey)).toEqual([
      "reminder_before_due",
      "payment_failed",
    ]);
  });

  it("n’offre aucun réglage pour un gabarit qui ne part jamais", () => {
    const reglables = new Set(
      NOTIFICATION_EVENTS.map((event) => event.templateKey),
    );
    for (const key of Object.keys(NON_EMITTED_EMAIL_TEMPLATES)) {
      expect(reglables.has(key as (typeof EMAIL_TEMPLATE_KEYS)[number])).toBe(
        false,
      );
    }
  });

  it("traite l’absence de ligne comme les défauts runtime", () => {
    expect(toNotificationPreferences(null)).toEqual({
      reminderBeforeDue: true,
      paymentFailed: true,
    });
  });

  it("lit une case décochée comme une désactivation explicite", () => {
    const formData = new FormData();
    formData.set("reminderBeforeDue", "on");

    expect(readNotificationPreferencesFromFormData(formData)).toEqual({
      reminderBeforeDue: true,
      paymentFailed: false,
    });
  });
});
