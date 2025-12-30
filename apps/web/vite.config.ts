import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  ssr: {
    // Keep server-only dependencies out of SSR bundle
    external: ['drizzle-orm', 'postgres'],
    // Ensure server-only code doesn't leak into client
    noExternal: ['@quackback/db', '@quackback/domain', '@quackback/email'],
  },
  optimizeDeps: {
    // Exclude server-only packages from dependency optimization
    exclude: ['@quackback/db', 'postgres', 'drizzle-orm'],
  },
  build: {
    rollupOptions: {
      // Externalize server-only modules in client build
      external: (id) => {
        // Externalize postgres and Node.js built-ins for client build
        if (id === 'postgres' || id.startsWith('postgres/')) return true
        if (id === 'drizzle-orm' || id.startsWith('drizzle-orm/')) return true
        // Externalize Node.js built-ins
        if (/^(crypto|fs|path|os|net|tls|stream|perf_hooks|node:)/.test(id)) return true
        return false
      },
    },
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart({
      srcDirectory: 'src',
      router: {
        routesDirectory: 'routes',
      },
    }),
    viteReact(),
  ],
})
