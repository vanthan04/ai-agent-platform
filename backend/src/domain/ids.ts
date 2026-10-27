import { z } from "zod";

const id = <B extends string>() => z.string().min(1).max(128).brand<B>();

export const TenantId = id<"TenantId">();
export type TenantId = z.infer<typeof TenantId>;

export const UserId = id<"UserId">();
export type UserId = z.infer<typeof UserId>;

export const TaskId = id<"TaskId">();
export type TaskId = z.infer<typeof TaskId>;

export const RunId = id<"RunId">();
export type RunId = z.infer<typeof RunId>;

export const StepId = id<"StepId">();
export type StepId = z.infer<typeof StepId>;

export const ToolCallId = id<"ToolCallId">();
export type ToolCallId = z.infer<typeof ToolCallId>;

export const EventId = id<"EventId">();
export type EventId = z.infer<typeof EventId>;

export const ArtifactId = id<"ArtifactId">();
export type ArtifactId = z.infer<typeof ArtifactId>;

export const ApprovalId = id<"ApprovalId">();
export type ApprovalId = z.infer<typeof ApprovalId>;

export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;
