const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".private"];

/**
 * An https address of a public server (D11): a public DNS name, no credentials, no query and no fragment. IP addresses and
 * single-label names such as `localhost` are refused, which also rules out the private and link-local ranges.
 * This is a first line only: a name can still resolve to a private address, so the call itself must check where it connects.
 */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;
  if (!/^[a-z][a-z0-9-]*$/.test(host.split(".").at(-1) ?? "")) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
