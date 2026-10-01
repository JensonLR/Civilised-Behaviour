/**
 * For later tooling only (`drizzle-kit generate/studio`, not installed): the server migrates itself from the embedded SQL in
 * `pgMigrations.ts` at boot. Kept as a plain object so nothing here imports a dev tool.
 */
export default {
  dialect: "postgresql",
  schema: "./src/persistence/pgSchema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
};
