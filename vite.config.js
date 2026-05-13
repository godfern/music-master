import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Avoid ENOENT on deps_temp_* when node_modules is churned or two dev servers run.
  cacheDir: '.vite',
})
