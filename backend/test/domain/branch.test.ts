import { describe, expect, it } from "vitest";
import { isProtectedBranch, matchesBranchPattern } from "../../src/domain";

describe("matchesBranchPattern", () => {
  it("matches exact names only", () => {
    expect(matchesBranchPattern("main", "main")).toBe(true);
    expect(matchesBranchPattern("main", "main2")).toBe(false);
    expect(matchesBranchPattern("main", "xmain")).toBe(false);
  });

  it("expands * across slashes", () => {
    expect(matchesBranchPattern("release/*", "release/1.0")).toBe(true);
    expect(matchesBranchPattern("release/*", "release/1.0/hotfix")).toBe(true);
    expect(matchesBranchPattern("release/*", "feat/release/1")).toBe(false);
  });

  it("treats other regex characters literally", () => {
    expect(matchesBranchPattern("rel.1", "relx1")).toBe(false);
    expect(matchesBranchPattern("rel.1", "rel.1")).toBe(true);
  });

  it("ignores a refs/heads/ prefix", () => {
    expect(matchesBranchPattern("main", "refs/heads/main")).toBe(true);
  });
});

describe("isProtectedBranch", () => {
  const patterns = ["main", "develop", "release/*"];
  it("flags protected and passes work branches", () => {
    expect(isProtectedBranch("develop", patterns)).toBe(true);
    expect(isProtectedBranch("release/2.0", patterns)).toBe(true);
    expect(isProtectedBranch("feat/abc-1-x", patterns)).toBe(false);
  });
  it("protects nothing when no patterns are given", () => {
    expect(isProtectedBranch("main", [])).toBe(false);
  });
});
