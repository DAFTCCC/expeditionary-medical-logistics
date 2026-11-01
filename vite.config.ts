import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<owner>.github.io/expeditionary-medical-logistics/
export default defineConfig({
  base: process.env.FIELDLINE_BASE ?? '/expeditionary-medical-logistics/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
