import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'], include: ['src/**/*.test.{js,jsx}'], css: false },
  plugins: [react()],
  server: { port: 3000, strictPort: true, proxy: { '/api': 'http://localhost:3001' } },
  build: {
    outDir: 'build',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
