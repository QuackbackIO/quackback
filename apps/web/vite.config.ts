import { defineConfig, loadEnv } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const EDITION = env.EDITION || 'self-hosted'
  const INCLUDE_EE = env.INCLUDE_EE === 'true'

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
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tanstackStart({
        srcDirectory: 'src',
        router: {
          routesDirectory: 'routes',
        },
      }),
      viteReact(),
    ],
  }
})
