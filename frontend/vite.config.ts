import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Charts are heavy and only Insights, Budgets and Net worth draw them, so they get
// their own chunk and load with those pages. React and the router are needed on
// every page. clsx and tailwind-merge go in `vendor`: they are tiny helpers that
// the entry needs, and leaving them to default chunking would let the entry pull
// the charts chunk in eagerly just to reach clsx.
const VENDOR_CHUNKS: { name: string; packages: RegExp }[] = [
  {
    name: 'charts',
    packages: /[\\/]node_modules[\\/](recharts|victory-vendor|d3|d3-[^\\/]+)[\\/]/,
  },
  {
    name: 'react',
    packages: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
  },
  {
    name: 'vendor',
    packages: /[\\/]node_modules[\\/](clsx|tailwind-merge)[\\/]/,
  },
];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          const chunk = VENDOR_CHUNKS.find((entry) => entry.packages.test(id));
          return chunk?.name;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
