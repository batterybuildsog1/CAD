import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Include patterns
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],

    // Setup file for custom matchers
    setupFiles: ['./src/test/setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/logger/**',
        'src/**/*.test.ts',
        'src/test/**',
      ],
      // Thresholds disabled during development - enable once all tests written
      // thresholds: {
      //   statements: 80,
      //   branches: 75,
      //   functions: 80,
      //   lines: 80,
      // },
    },

    // Global timeout
    testTimeout: 10000,

    // Reporter
    reporters: ['verbose'],
  },

  // Resolve @ alias
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
