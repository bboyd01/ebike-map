import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  server: {
    // Local dev: point /route and /data at a running stack (see README).
    proxy: {
      '/route': process.env.EBIKE_API ?? 'http://localhost:8080',
      '/data': process.env.EBIKE_API ?? 'http://localhost:8080',
    },
  },
  test: { environment: 'node' },
});
