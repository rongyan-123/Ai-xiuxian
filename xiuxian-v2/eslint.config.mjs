import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Globally disable the rule that forbids 'any'.
  // This makes @typescript-eslint/no-explicit-any effectively off across the project.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Reject empty catch blocks (task 1.5)
      "no-empty": ["error", { "allowEmptyCatch": false }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
