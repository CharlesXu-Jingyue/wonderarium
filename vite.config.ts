import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const dev = mode === 'development';
  return {
    root: 'src',
    base: './',
    build: {
      outDir: '../dist/renderer',
      // In watch mode, overwrite stable file names in place so the window
      // never reloads into a half-emptied folder.
      emptyOutDir: !dev,
      target: 'esnext',
      sourcemap: true,
      chunkSizeWarningLimit: 1000, // three.js is most of it, and it is local
      minify: !dev,
      rolldownOptions: dev
        ? { output: { entryFileNames: '[name].js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' } }
        : undefined,
    },
  };
});
