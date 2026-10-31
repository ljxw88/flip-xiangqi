import { defineConfig } from 'vite';

// GitHub Pages serves the project at /flip-xiangqi/; local dev and other hosts use /.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  server: {
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${process.env.WS_PORT ?? '3001'}`,
        ws: true,
      },
    },
  },
});
