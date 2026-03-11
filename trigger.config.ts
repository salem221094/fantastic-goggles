import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "my-project",
  runtime: "node",
  logLevel: "log",
  retries: {
    enabled: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      additionalFiles({
        files: ["skills_en.csv", "data/scored_skills.csv"],
      }),
    ],
  },
});
