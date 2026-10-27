import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isPublicAddress } from "./public-address";

/** The name resolved to an address a request from this server must never reach. */
export class BlockedAddressError extends Error {
  readonly code = "blocked_address";
  constructor() {
    super("the address is not public");
  }
}

export type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A DNS lookup for `https.request({ lookup })` that refuses non-public addresses. Because the connection uses the address this
 * function returns, the check cannot be undone by a second, different answer (DNS rebinding). If a name resolves to even one
 * non-public address the whole lookup fails, so a mixed answer cannot be used to smuggle one in.
 */
export function createSafeLookup(options: { resolver?: Resolver; allowNonPublic?: boolean } = {}) {
  const resolver = options.resolver ?? systemResolver;
  return (hostname: string, lookupOptions: { all?: boolean; family?: number }, callback: LookupCallback): void => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), []);
        if (!options.allowNonPublic && addresses.some((entry) => !isPublicAddress(entry.address))) return callback(new BlockedAddressError(), []);
        const wanted = lookupOptions.family === 4 || lookupOptions.family === 6 ? addresses.filter((entry) => entry.family === lookupOptions.family) : addresses;
        const [first] = wanted;
        if (!first) return callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), []);
        return lookupOptions.all ? callback(null, [...wanted]) : callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, []),
    );
  };
}
