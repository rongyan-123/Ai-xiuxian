import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/** Vitest config for integration tests that need a real test database. */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'e2e/**', '.next/**'],
    globals: true,
    env: {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5433/xiuxian_test?schema=public',
    },
    // Longer timeout for DB operations
    testTimeout: 30000,
  },
})
