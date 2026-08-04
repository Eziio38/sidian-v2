import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const designSystemRoot = path.join(projectRoot, "src/design-system");
const tokenPath = path.join(designSystemRoot, "tokens.css");

const requiredFiles = [
  "src/design-system/tokens.css",
  "src/design-system/tokens.ts",
  "src/design-system/catalogue.tsx",
  "docs/design-system/README.md",
  "docs/design-system/TOKENS.md",
  "docs/design-system/TYPOGRAPHY.md",
  "docs/design-system/SPACING.md",
  "docs/design-system/COMPONENTS.md",
  "docs/design-system/ACCESSIBILITY.md",
  "docs/design-system/COMPONENT_AUDIT.md",
];

const requiredTokens = [
  "--ds-color-background",
  "--ds-color-surface",
  "--ds-color-text-primary",
  "--ds-color-accent",
  "--ds-color-danger",
  "--ds-type-display-size",
  "--ds-type-h1-size",
  "--ds-type-body-size",
  "--ds-space-1",
  "--ds-space-24",
  "--ds-radius-sm",
  "--ds-radius-pill",
  "--ds-shadow-xs",
  "--ds-shadow-xl",
  "--ds-duration-fast",
  "--ds-ease-standard",
  "--ds-layout-sidebar-width",
  "--ds-layout-content-width",
  "--ds-breakpoint-md",
];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = path.join(directory, entry);
    return statSync(filePath).isDirectory() ? walk(filePath) : [filePath];
  });
}

const failures = [];

for (const relativePath of requiredFiles) {
  try {
    statSync(path.join(projectRoot, relativePath));
  } catch {
    failures.push(`Fichier requis absent : ${relativePath}`);
  }
}

const tokenSource = readFileSync(tokenPath, "utf8");
for (const token of requiredTokens) {
  if (!tokenSource.includes(token)) {
    failures.push(`Token requis absent : ${token}`);
  }
}

const definedTokens = new Set(
  [...tokenSource.matchAll(/(--ds-[a-z0-9-]+)\s*:/g)].map(
    (match) => match[1],
  ),
);

for (const filePath of walk(designSystemRoot).filter(
  (file) =>
    /\.(css|tsx)$/.test(file) &&
    file !== tokenPath &&
    !file.endsWith(".test.tsx"),
)) {
  const relativePath = path.relative(projectRoot, filePath);
  const source = readFileSync(filePath, "utf8");
  const sourceWithoutOfficialMediaQueries = source.replace(
    /@media\s+\((?:min|max)-width:\s*(?:40|48|64|80)rem\)/g,
    "",
  );

  if (/<svg\b/i.test(source)) {
    failures.push(`${relativePath} contient un SVG inline ; utiliser Lucide.`);
  }

  if (/style\s*=\s*\{\{/.test(source)) {
    failures.push(
      `${relativePath} contient un style inline ; utiliser un token et un module CSS.`,
    );
  }

  if (/\b(?:bg|text|border|rounded|max-w|min-w|w|h)-\[[^\]]+\]/.test(source)) {
    failures.push(
      `${relativePath} contient une valeur Tailwind arbitraire interdite.`,
    );
  }

  if (
    filePath.endsWith(".css") &&
    /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(source)
  ) {
    failures.push(
      `${relativePath} contient une couleur brute ; utiliser un token --ds-*.`,
    );
  }

  if (
    filePath.endsWith(".css") &&
    /(?:^|[\s:(])\d+(?:\.\d+)?(?:px|rem|em|vh|vw|ms|s)\b/m.test(
      sourceWithoutOfficialMediaQueries,
    )
  ) {
    failures.push(
      `${relativePath} contient une longueur ou durée brute ; utiliser un token --ds-*.`,
    );
  }

  if (filePath.endsWith(".css") && /@keyframes\b|\banimation\s*:/m.test(source)) {
    failures.push(
      `${relativePath} contient une animation ; la Phase 1 fournit uniquement les motion tokens.`,
    );
  }

  for (const match of source.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)) {
    const token = match[1];
    if (!definedTokens.has(token)) {
      failures.push(`${relativePath} utilise un token non défini : ${token}`);
    }
  }
}

const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
if (!packageJson.dependencies?.["lucide-react"]) {
  failures.push("lucide-react doit être la bibliothèque d’icônes officielle.");
}

if (failures.length > 0) {
  console.error("Design System check failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Design System check passed (${definedTokens.size} tokens, Lucide unique, composants sans valeur arbitraire).`,
);
