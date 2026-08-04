import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    // Les suites RTL les plus lourdes (conversational-workspace) dépassent le
    // défaut de 5 s uniquement lorsqu'elles tournent en parallèle du reste de
    // la suite : le test passe isolément. La limite par défaut produisait donc
    // un échec de charge, pas une régression fonctionnelle.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
