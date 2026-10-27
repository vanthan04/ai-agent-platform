import { z } from "zod";

/** Where a provider plugs in: where a task comes from, where code is read from, where results go. */
export const ProviderCategory = z.enum(["input", "source_control", "output"]);
export type ProviderCategory = z.infer<typeof ProviderCategory>;

export const ProviderId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export type ProviderId = z.infer<typeof ProviderId>;

export const ProviderVersion = z.string().regex(/^\d+\.\d+\.\d+$/);
export type ProviderVersion = z.infer<typeof ProviderVersion>;

const fieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);

const fieldBase = {
  key: fieldKey,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  required: z.boolean().default(false),
  /** The only conditional logic allowed: show this field when another field equals a value. */
  visibleWhen: z.object({ field: fieldKey, equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
};

/** A closed set of field types. A schema is data: it never carries code, so the UI can render it and the backend can check it. */
export const ConfigField = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("string"), maxLength: z.number().int().positive().max(2_000).optional() }),
  z.object({ ...fieldBase, type: z.literal("text") }),
  z.object({ ...fieldBase, type: z.literal("number"), min: z.number().optional(), max: z.number().optional() }),
  z.object({ ...fieldBase, type: z.literal("boolean") }),
  z.object({
    ...fieldBase,
    type: z.literal("select"),
    options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1).max(100) })).min(1).max(100),
  }),
  /** Holds a reference into the secrets layer, never the secret itself. */
  z.object({ ...fieldBase, type: z.literal("secret") }),
]);
export type ConfigField = z.infer<typeof ConfigField>;

export const ConfigSchema = z
  .object({ fields: z.array(ConfigField).max(50) })
  .superRefine((schema, ctx) => {
    const keys = new Set<string>();
    for (const [index, field] of schema.fields.entries()) {
      if (keys.has(field.key)) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "key"], message: `duplicate field key ${field.key}` });
      }
      keys.add(field.key);
    }
    for (const [index, field] of schema.fields.entries()) {
      if (field.visibleWhen && (field.visibleWhen.field === field.key || !keys.has(field.visibleWhen.field))) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "visibleWhen"],
          message: `visibleWhen must name another field of this schema`,
        });
      }
      if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
        ctx.addIssue({ code: "custom", path: ["fields", index], message: "min is greater than max" });
      }
    }
  });
export type ConfigSchema = z.infer<typeof ConfigSchema>;

export const SetupStatus = z.enum(["not_configured", "connected", "error"]);
export type SetupStatus = z.infer<typeof SetupStatus>;

/** What a provider tells the platform about itself. The UI renders `configSchema`; the backend stays the authority that validates a configuration against it. */
export const ProviderDescriptor = z.object({
  id: ProviderId,
  displayName: z.string().min(1).max(100),
  category: ProviderCategory,
  version: ProviderVersion,
  capabilities: z.array(z.string().min(1).max(100)).max(50),
  configSchema: ConfigSchema,
  requiredPermissions: z.array(z.string().min(1).max(100)).max(50),
  setupStatus: SetupStatus,
  limitations: z.array(z.string().min(1).max(500)).max(50),
});
export type ProviderDescriptor = z.infer<typeof ProviderDescriptor>;
