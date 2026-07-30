import { defineConfig } from "vitest/config";

// Infra has no unit tests; ensure vitest never scans generated CDK assets
// (cdk.out) or compiled output (dist), which can contain bundled Lambda code.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/cdk.out/**"],
  },
});
