import { bigint, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

/** Drizzle view of the tables created by `pgMigrations.ts` (the embedded SQL is the source of truth at boot; keep them in step). */
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    seed: bigint("seed", { mode: "number" }).notNull(),
    rev: integer("rev").notNull(),
    savedAt: bigint("saved_at", { mode: "number" }).notNull(),
    owner: text("owner").notNull(),
    sections: jsonb("sections").$type<Record<string, string>>().notNull(),
    sectionVersions: jsonb("section_versions").$type<Record<string, number>>().notNull(),
  },
  (t) => [uniqueIndex("campaigns_code_uq").on(t.code), index("campaigns_saved_at_idx").on(t.savedAt)],
);

export const campaignMembers = pgTable(
  "campaign_members",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    identityKey: text("identity_key").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.identityKey] }), index("campaign_members_key_idx").on(t.identityKey)],
);

export const schemaVersion = pgTable("schema_version", {
  version: integer("version").primaryKey(),
  appliedAt: bigint("applied_at", { mode: "number" }).notNull(),
});
