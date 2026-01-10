import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env from monorepo root where .env file lives
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '')

  const EDITION = process.env.EDITION || env.EDITION || 'self-hosted'
  const INCLUDE_EE = process.env.INCLUDE_EE === 'true' || env.INCLUDE_EE === 'true'
  const USE_CLOUDFLARE = EDITION === 'cloud'

  // EE package aliases - point to stubs when EE not included
  const eeAliases: Record<string, string> = !INCLUDE_EE
    ? {
        '@quackback/ee-sso': path.resolve(__dirname, 'src/lib/ee/stubs/sso.ts'),
        '@quackback/ee-scim': path.resolve(__dirname, 'src/lib/ee/stubs/scim.ts'),
        '@quackback/ee-audit': path.resolve(__dirname, 'src/lib/ee/stubs/audit.ts'),
      }
    : {}

  return {
    server: {
      port: 3000,
      allowedHosts: true,
    },
    // Using Vite defaults for build (website doesn't set these explicitly)
    // NOTE: Removed environments.ssr config that was causing __name helper to leak
    // into SSR dehydration. The noExternal setting caused @tanstack/react-router
    // to be re-bundled through esbuild, which added __name calls to seroval's
    // stream code. These calls aren't defined in the browser, causing runtime errors.
    define: {
      __EDITION__: JSON.stringify(EDITION),
      __INCLUDE_EE__: JSON.stringify(INCLUDE_EE),
    },
    resolve: {
      alias: eeAliases,
    },
    plugins: [
      tailwindcss(),
      tsconfigPaths({
        projects: ['./tsconfig.json'],
      }),
      USE_CLOUDFLARE && cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tanstackStart({
        srcDirectory: 'src',
        router: {
          routesDirectory: 'routes',
        },
      }),
      viteReact(),
    ].filter(Boolean) as PluginOption[],
  }
})
