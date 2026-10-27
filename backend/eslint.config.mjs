import tseslint from "typescript-eslint";

// Architecture rules (D19 in docs/decisions.md). Each bounded context lives in src/<context>/ and, where it has behaviour beyond
// pure rules, is split into domain / application / infrastructure / interface. Dependencies point inwards and between contexts
// only along the allowed list below; a context is used through its index file, never through its inner folders.
const CONTEXTS = ["shared-kernel", "policy", "execution", "integrations", "identity", "projects", "vault", "mcp"];

/** For each context, the other contexts it may depend on. */
const ALLOWED = {
  "shared-kernel": [],
  policy: ["shared-kernel"],
  execution: ["shared-kernel", "policy", "identity", "projects"],
  integrations: ["shared-kernel"],
  identity: ["shared-kernel"],
  projects: ["shared-kernel", "identity", "policy"],
  vault: ["shared-kernel"],
  mcp: ["shared-kernel", "identity", "projects", "vault"],
};

const LAYERS = ["domain", "application", "infrastructure", "interface"];

const OTHER_LAYERS = {
  domain: ["application", "infrastructure", "interface"],
  application: ["infrastructure", "interface"],
  infrastructure: ["interface"],
  interface: ["infrastructure"],
};

const layerGroups = (layer) => {
  const groups = [];
  const forbiddenLayers = OTHER_LAYERS[layer];
  groups.push({
    group: forbiddenLayers.flatMap((other) => [`**/${other}`, `**/${other}/*`]),
    message: `${layer} must not depend on ${forbiddenLayers.join(", ")}`,
  });
  if (layer === "domain" || layer === "application") {
    groups.push({
      group: ["**/generated/*", "**/config", "**/config/*", "**/database", "**/database/*", "**/network", "**/network/*", "@prisma/*", "pg"],
      message: `${layer} must not touch the database client or configuration`,
    });
  }
  if (layer === "domain") {
    groups.push({
      group: ["@nestjs/*", "node:*"],
      message: "the domain stays free of frameworks and I/O",
    });
  }
  return groups;
};

const crossContextGroups = (context) => {
  const groups = [];
  for (const other of CONTEXTS) {
    if (other === context) continue;
    groups.push(
      ALLOWED[context].includes(other)
        ? { group: [`**/${other}/*`], message: `use ${other} through its index file only` }
        : { group: [`**/${other}`, `**/${other}/*`], message: `${context} must not depend on ${other}` },
    );
  }
  groups.push({ group: ["**/app", "**/app/*"], message: "a context must not depend on the app composition root" });
  return groups;
};

const restrict = (files, groups) => ({ files, rules: { "no-restricted-imports": ["error", { patterns: groups }] } });

const boundaryConfigs = [
  ...CONTEXTS.flatMap((context) => [
    restrict([`src/${context}/*.ts`], crossContextGroups(context)),
    ...LAYERS.map((layer) => restrict([`src/${context}/${layer}/**/*.ts`], [...layerGroups(layer), ...crossContextGroups(context)])),
  ]),
  // The shared kernel is the innermost part of every context, so all of it follows the domain rules.
  restrict(["src/shared-kernel/**/*.ts"], [...layerGroups("domain"), ...crossContextGroups("shared-kernel")]),
  // The composition root may use any context, through its index.
  restrict(["src/app/**/*.ts"], CONTEXTS.map((context) => ({ group: [`**/${context}/*`], message: `use ${context} through its index file only` }))),
];

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "coverage/**", "src/generated/**"] },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.ts"] })),
  ...boundaryConfigs,
];
