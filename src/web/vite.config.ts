/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Logic tests live in the repo-level tests/web (AGENTS.md directory layout).
  test: { dir: '../../tests/web', globals: true },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/collector': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/collector/, ''),
      },
    },
  },
})
