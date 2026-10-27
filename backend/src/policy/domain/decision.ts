import { z } from "zod";

/** allow: run it. ask: needs a persisted human approval first. deny: never. */
export const PolicyDecision = z.enum(["allow", "ask", "deny"]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;
