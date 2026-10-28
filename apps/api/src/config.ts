function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://commons:commons@localhost:5432/commons"),
  sessionSecret: env("SESSION_SECRET", "dev-only-change-me-please-32-bytes-min"),
  devLogin: env("DEV_LOGIN", "true") === "true",
  webOrigin: env("WEB_ORIGIN", "http://localhost:5173"),
  pagesOrigin: env("PAGES_ORIGIN", "http://localhost:4100"),
  apiPort: Number(env("API_PORT", "4000")),
  /** The API address people's machines use; baked into the CLI they download */
  publicApiUrl: env("PUBLIC_API_URL", "http://localhost:4000"),
  pagesPort: Number(env("PAGES_PORT", "4100")),
  s3: {
    endpoint: env("S3_ENDPOINT", "http://localhost:9000"),
    accessKey: env("S3_ACCESS_KEY", "commons"),
    secretKey: env("S3_SECRET_KEY", "commons-secret"),
    bucket: env("S3_BUCKET", "commons-pages"),
  },
  limits: {
    maxQueryDepth: 10,
    maxIngestRows: 200_000,
    agentRowLimit: 200,
  },
};
