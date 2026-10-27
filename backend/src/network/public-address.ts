import { isIP } from "node:net";

function parseIPv4(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").map(Number);
}

/** Public means: reachable on the open internet, not a private, loopback, link-local, shared, documentation, multicast or reserved range. */
function isPublicIPv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT, 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local, includes cloud metadata services
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol assignments, documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  return a < 224; // multicast, reserved and broadcast are 224 and up
}

/** The 16 bytes of an IPv6 address, or `undefined` for anything that is not a plain IPv6 address (a zone id such as `%eth0` is refused). */
function parseIPv6(address: string): number[] | undefined {
  if (address.includes("%") || isIP(address) !== 6) return undefined;
  let text = address;
  const tail = text.slice(text.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return undefined;
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groupsOf = (part: string | undefined): number[] => (part === undefined || part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16)));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined;
  const groups = halves.length === 1 ? head : [...head, ...new Array<number>(missing).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff)) return undefined;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

/** Only global unicast (2000::/3) is accepted, minus documentation and transition ranges; IPv4 inside an IPv6 address is judged as IPv4. */
function isPublicIPv6(bytes: readonly number[]): boolean {
  const zeroUntil = (end: number): boolean => bytes.slice(0, end).every((byte) => byte === 0);
  if (zeroUntil(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicIPv4(bytes.slice(12)); // ::ffff:a.b.c.d
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) {
    return isPublicIPv4(bytes.slice(12)); // 64:ff9b::/96, NAT64
  }
  if (((bytes[0] ?? 0) & 0xe0) !== 0x20) return false; // loopback, unspecified, unique-local, link-local, multicast, everything not global unicast
  const first = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  const second = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  if (first === 0x2001 && (second & 0xfe00) === 0) return false; // 2001::/23: protocol assignments, Teredo
  if (first === 0x2002) return false; // 6to4
  if (first === 0x3fff && (second & 0xf000) === 0) return false; // documentation
  return true;
}

/** Whether an IP address may be connected to from the server. Anything that is not an IP address is not public. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}
