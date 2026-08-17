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
    dts: {
      // tsup's declaration worker still uses the TypeScript 6 API and injects
      // a deprecated `baseUrl`. The widget package pins typescript to the 6.x
      // compatibility package for that worker; tsc for the app stays on 7.
      compilerOptions: {
        ignoreDeprecations: '6.0',
      },
    },
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
