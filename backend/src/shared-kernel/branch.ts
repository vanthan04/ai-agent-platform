const normalize = (branch: string): string => branch.trim().replace(/^refs\/heads\//, "");

const escapeRegExp = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Glob match where `*` matches any run of characters, including `/` (so `release/*` covers `release/1.0/x`). */
export function matchesBranchPattern(pattern: string, branch: string): boolean {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`).test(normalize(branch));
}

export function isProtectedBranch(branch: string, protectedPatterns: readonly string[]): boolean {
  return protectedPatterns.some((pattern) => matchesBranchPattern(pattern, branch));
}
