import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: ['src/types.test.ts', '**/node_modules/**', '**/dist/**'],
  },
})
