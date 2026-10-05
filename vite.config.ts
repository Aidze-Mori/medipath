import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  publicDir: command === 'build' ? false : 'public',
  build: { manifest: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3001' }, watch: { ignored: ['**/test-results*/**', '**/playwright-report/**', '**/artifacts/**', '**/docs/release/previews/**'] } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
}));
