import { defineConfig, loadEnv, type PluginOption, type UserConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const env = loadEnv(mode, process.cwd(), '')

  // Build-time edition configuration
  const EDITION = env.EDITION || 'self-hosted'
  const INCLUDE_EE = env.INCLUDE_EE === 'true'

  // Deployment target: 'bun' (self-hosted) or 'cloudflare' (cloud)
  const DEPLOY_TARGET = env.DEPLOY_TARGET || 'bun'
  const isCloudflare = DEPLOY_TARGET === 'cloudflare'

  // EE package aliases - point to stubs when EE not included
  const eeAliases: Record<string, string> = !INCLUDE_EE
    ? {
        '@quackback/ee-sso': path.resolve(__dirname, 'src/lib/ee/stubs/sso.ts'),
        '@quackback/ee-scim': path.resolve(__dirname, 'src/lib/ee/stubs/scim.ts'),
        '@quackback/ee-audit': path.resolve(__dirname, 'src/lib/ee/stubs/audit.ts'),
      }
    : {}

  // Conditionally load Cloudflare plugin for cloud deployments
  let cloudflarePlugin: PluginOption = []
  if (isCloudflare) {
    const { cloudflare } = await import('@cloudflare/vite-plugin')
    cloudflarePlugin = cloudflare({ viteEnvironment: { name: 'ssr' } })
  }

  return {
    server: {
      port: 3000,
      allowedHosts: true,
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
    // Externalize Cloudflare-specific imports for SSR build
    ssr: {
      external: isCloudflare ? ['cloudflare:workers'] : [],
    },
    build: {
      rollupOptions: {
        external: isCloudflare ? ['cloudflare:workers'] : [],
      },
    },
    plugins: [
      tailwindcss(),
      tsconfigPaths({
        projects: ['./tsconfig.json'],
      }),
      cloudflarePlugin,
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
