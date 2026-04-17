import { defineConfig } from 'tsup'

export default defineConfig([
  // Library build — ESM + CJS + declarations.
  // React subpath only builds when consumers import it.
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    clean: true,
    external: ['react'],
  },
  // Browser IIFE — served verbatim by /api/widget/sdk.js
  {
    entry: { browser: 'src/browser-queue.ts' },
    format: ['iife'],
    globalName: 'QuackbackBundle',
    minify: true,
    sourcemap: false,
    target: 'es2020',
    outExtension: () => ({ js: '.js' }),
  },
])
