"use client";

import { useId } from "react";

import { useTheme } from "@/components/theme/theme-provider";
import {
  THEME_PREFERENCE_DESCRIPTIONS,
  THEME_PREFERENCE_LABELS,
  THEME_PREFERENCES,
  type ThemePreference,
} from "@/lib/theme/theme";

import styles from "./appearance-control.module.css";

/**
 * Choix de l'apparence — Clair / Sombre / Automatique.
 *
 * Groupe de boutons radio natifs : les flèches naviguent entre les options et
 * le rôle `radiogroup` est obtenu sans ARIA manuelle. Le changement est
 * appliqué immédiatement au document ; la persistance (cookie + compte) part
 * en arrière-plan, sans état de chargement — un choix d'affichage ne doit
 * jamais faire attendre.
 */
export function AppearanceControl() {
  const { preference, resolved, setPreference } = useTheme();
  const groupName = useId();

  return (
    <>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>
          Choisis l’apparence de Sidian sur cet appareil et sur tes autres
          sessions.
        </legend>

        {THEME_PREFERENCES.map((option: ThemePreference) => (
          <label key={option} className={styles.option}>
            <input
              type="radio"
              className={styles.input}
              name={groupName}
              value={option}
              checked={preference === option}
              onChange={() => setPreference(option)}
            />
            <span className={styles.label}>
              {THEME_PREFERENCE_LABELS[option]}
            </span>
            <span className={styles.hint}>
              {THEME_PREFERENCE_DESCRIPTIONS[option]}
            </span>
          </label>
        ))}
      </fieldset>

      {/*
        `aria-live` annonce le thème réellement appliqué : en mode
        « Automatique », le libellé choisi ne suffit pas à savoir ce qui est
        affiché.
      */}
      <p className={styles.status} aria-live="polite">
        {preference === "system"
          ? `Ton appareil est actuellement en mode ${
              resolved === "dark" ? "sombre" : "clair"
            }.`
          : `Apparence ${THEME_PREFERENCE_LABELS[preference].toLowerCase()} appliquée.`}
      </p>
    </>
  );
}
