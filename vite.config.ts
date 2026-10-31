import { defineConfig } from 'vite';

export default defineConfig({
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
