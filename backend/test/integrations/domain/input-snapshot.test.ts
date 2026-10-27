import { describe, expect, it } from "vitest";
import { InputSnapshot } from "../../../src/integrations";
import { NOW } from "../../support/time";

const snapshot = {
  tenantId: "tenant-1",
  projectId: "project-1",
  runId: "run-1",
  providerId: "jira",
  providerVersion: "1.0.0",
  sourceId: "ABC-123",
  sourceUrl: "https://example.invalid/browse/ABC-123",
  title: "Add retry to uploader",
  description: "Retry failed uploads three times.",
  acceptanceCriteria: ["uploads are retried", "the final failure is reported"],
  metadata: { priority: "High" },
  sourceUpdatedAt: NOW,
  fetchedAt: NOW,
  contentHash: "c".repeat(64),
};

describe("InputSnapshot", () => {
  it("accepts a full snapshot and one without optional source fields", () => {
    expect(InputSnapshot.safeParse(snapshot).success).toBe(true);
    const { sourceId, sourceUrl, sourceUpdatedAt, ...minimal } = snapshot;
    void sourceId;
    void sourceUrl;
    void sourceUpdatedAt;
    expect(InputSnapshot.safeParse({ ...minimal, providerId: "custom_prompt" }).success).toBe(true);
  });

  it("needs a content hash that is 64 lowercase hex characters", () => {
    expect(InputSnapshot.safeParse({ ...snapshot, contentHash: "c".repeat(63) }).success).toBe(false);
    expect(InputSnapshot.safeParse({ ...snapshot, contentHash: "C".repeat(64) }).success).toBe(false);
    expect(InputSnapshot.safeParse({ ...snapshot, contentHash: undefined }).success).toBe(false);
  });

  it("is tied to a project and a run", () => {
    expect(InputSnapshot.safeParse({ ...snapshot, projectId: undefined }).success).toBe(false);
    expect(InputSnapshot.safeParse({ ...snapshot, runId: undefined }).success).toBe(false);
  });

  it("bounds the size of the content it keeps", () => {
    expect(InputSnapshot.safeParse({ ...snapshot, description: "x".repeat(20_001) }).success).toBe(false);
    expect(InputSnapshot.safeParse({ ...snapshot, title: "" }).success).toBe(false);
    expect(InputSnapshot.safeParse({ ...snapshot, sourceUrl: "not a url" }).success).toBe(false);
    const manyEntries = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "v"]));
    expect(InputSnapshot.safeParse({ ...snapshot, metadata: manyEntries }).success).toBe(false);
  });
});
