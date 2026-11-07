import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
<<<<<<< HEAD
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
=======
>>>>>>> aaadb0b08234d2d01d85b3156c497bd13a7962ce
  server: { port: 5173, open: false },
  build: { outDir: 'dist', sourcemap: true },
});
