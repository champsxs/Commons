import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://commons:commons@localhost:5432/commons_test",
      DEV_LOGIN: "true",
      S3_BUCKET: "commons-pages-test",
    },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
