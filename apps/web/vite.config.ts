import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Build-time edition configuration
  const EDITION = env.EDITION || 'self-hosted'
  const INCLUDE_EE = env.INCLUDE_EE === 'true'

  // EE package aliases - point to stubs when EE not included
  const eeAliases = !INCLUDE_EE
    ? {
        '@quackback/ee-sso': path.resolve(__dirname, 'src/lib/ee/stubs/sso.ts'),
        '@quackback/ee-scim': path.resolve(__dirname, 'src/lib/ee/stubs/scim.ts'),
        '@quackback/ee-audit': path.resolve(__dirname, 'src/lib/ee/stubs/audit.ts'),
      }
    : {}

  return {
    server: {
      port: 3000,
    },
    define: {
      // Build-time constants for tree-shaking
      __EDITION__: JSON.stringify(EDITION),
      __INCLUDE_EE__: JSON.stringify(INCLUDE_EE),
    },
    resolve: {
      alias: {
        ...eeAliases,
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
      nitro({ preset: 'bun' }),
      viteReact(),
    ],
  }
})
