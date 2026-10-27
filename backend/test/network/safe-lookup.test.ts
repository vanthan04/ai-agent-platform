import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { BlockedAddressError, createSafeLookup, type Resolver } from "../../src/network";

const answer = (...addresses: [string, 4 | 6][]): Resolver => async () => addresses.map(([address, family]) => ({ address, family }));

type Result = { error: Error | null; value: string | LookupAddress[]; family?: number };

const run = (lookup: ReturnType<typeof createSafeLookup>, options: { all?: boolean; family?: number } = {}): Promise<Result> =>
  new Promise((resolve) => lookup("mcp.example.com", options, (error, value, family) => resolve({ error, value, family })));

describe("createSafeLookup", () => {
  it("returns a public address", async () => {
    expect(await run(createSafeLookup({ resolver: answer(["93.184.216.34", 4]) }))).toEqual({ error: null, value: "93.184.216.34", family: 4 });
  });

  it("returns the whole list when asked for all addresses", async () => {
    const result = await run(createSafeLookup({ resolver: answer(["93.184.216.34", 4], ["2606:2800:220:1::1", 6]) }), { all: true });
    expect(result.error).toBeNull();
    expect(result.value).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
  });

  it("honours the requested family", async () => {
    const lookup = createSafeLookup({ resolver: answer(["93.184.216.34", 4], ["2606:2800:220:1::1", 6]) });
    expect((await run(lookup, { family: 6 })).value).toBe("2606:2800:220:1::1");
  });

  it("refuses a name that resolves to a private, loopback or metadata address", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1"]) {
      const result = await run(createSafeLookup({ resolver: answer([address, 4]) }));
      expect(result.error).toBeInstanceOf(BlockedAddressError);
    }
    expect((await run(createSafeLookup({ resolver: answer(["::1", 6]) }))).error).toBeInstanceOf(BlockedAddressError);
  });

  it("refuses the whole answer when even one address is not public, so a mixed answer cannot smuggle one in", async () => {
    const result = await run(createSafeLookup({ resolver: answer(["93.184.216.34", 4], ["127.0.0.1", 4]) }), { all: true });
    expect(result.error).toBeInstanceOf(BlockedAddressError);
    expect(result.value).toEqual([]);
  });

  it("passes a resolver failure on without calling it blocked", async () => {
    const failing: Resolver = async () => {
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    };
    const result = await run(createSafeLookup({ resolver: failing }));
    expect(result.error).not.toBeInstanceOf(BlockedAddressError);
    expect((result.error as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
    expect((await run(createSafeLookup({ resolver: answer() }))).error).toBeTruthy();
  });

  it("allows non-public addresses only when asked to, which only tests do", async () => {
    expect((await run(createSafeLookup({ resolver: answer(["127.0.0.1", 4]), allowNonPublic: true }))).error).toBeNull();
  });
});
