const TEMPLATE_ENV = /^\.env\.(example|sample|template)$/i;

const SECRET_BASENAME =
  /^(\.env(\..+)?|\.npmrc|\.netrc|\.pgpass|auth\.json|credentials(\.json)?|secrets?\.[^/]+|id_(rsa|dsa|ecdsa|ed25519)(\..+)?|.+\.(pem|key|p12|pfx|jks|keystore|tfvars|secrets?))$/i;

export function pathSegments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== ".");
}

export function isSecretPath(path: string): boolean {
  const base = pathSegments(path).at(-1) ?? "";
  return !TEMPLATE_ENV.test(base) && SECRET_BASENAME.test(base);
}

export const escapesWorkspace = (path: string): boolean => pathSegments(path).includes("..");

export const touchesGitDir = (path: string): boolean => pathSegments(path).includes(".git");

export const touchesNodeModules = (path: string): boolean => pathSegments(path).includes("node_modules");
