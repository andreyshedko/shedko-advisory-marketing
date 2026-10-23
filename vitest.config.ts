import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": process.cwd() } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
