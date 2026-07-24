import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

/**
 * Replace the server-only structured logger with a no-op stub in the CLIENT
 * environment. `createServerFn` modules hold a module-scoped
 * `logger.child({ component })` that runs at import time; left alone it pulls
 * pino + node:async_hooks into the browser bundle. SSR and the server runtime
 * keep the real logger.
 */
function stubServerLoggerInClient(): PluginOption {
  const stub = path.resolve(__dirname, 'src/lib/server/logger.client-stub.ts')
  return {
    name: 'quackback:stub-server-logger-in-client',
    enforce: 'pre',
    resolveId(id) {
      // `this.environment` is available in per-environment plugin pipelines.
      if (this.environment?.name !== 'client') return null
      if (
        id === '@/lib/server/logger' ||
        id === '@/lib/server/log-context' ||
        id === '@quackback/logger' ||
        id === '@quackback/logger/context' ||
        /\/lib\/server\/logger(\.ts)?$/.test(id) ||
        /\/lib\/server\/log-context(\.ts)?$/.test(id)
      ) {
        return stub
      }
      return null
    },
  }
}

function getBuildInfo() {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
  let gitCommit = 'unknown'
  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    // git unavailable
  }
  return {
    version: pkg.version ?? '0.0.0',
    commit: gitCommit,
    buildTime: new Date().toISOString(),
  }
}

export default defineConfig(({ mode }) => {
  // Load env from monorepo root where .env file lives
  loadEnv(mode, path.resolve(__dirname, '../../'), '')

  const buildInfo = getBuildInfo()

  return {
    define: {
      __APP_VERSION__: JSON.stringify(buildInfo.version),
      __GIT_COMMIT__: JSON.stringify(buildInfo.commit),
      __BUILD_TIME__: JSON.stringify(buildInfo.buildTime),
    },
    server: {
      port: Number(process.env.PORT || 3000),
      // Without this, a taken port silently bumps to the next free one while
      // BASE_URL/TRUSTED_ORIGINS (and every cookie/CORS check derived from
      // them) still point at the original port — fail loudly instead.
      strictPort: true,
      cors: mode === 'development',
      allowedHosts: true,
      hmr: {
        overlay: false,
      },
    },
    build: {
      rolldownOptions: {
        // TanStack Router SSR code imports node builtins (node:stream, node:async_hooks)
        // that end up in the client bundle. Mark node: imports as external since they're
        // SSR-only code paths that never execute in the browser.
        external: [/^node:/],
        // NO manualChunks pinning — deliberately. Directory-pinned chunks
        // (route-<segment>, components-admin-<section>) looked tidy but broke
        // code-splitting app-wide: rolldown places modules shared between a
        // pinned chunk and the entry INSIDE the pinned chunk, so the entry
        // imported router-core/error-page helpers *from* route-admin and every
        // page — the portal and the embeddable /widget iframe on third-party
        // sites — eagerly downloaded the entire admin app (~1.7 MB gzipped).
        // Usage-based splitting keeps the eager set honest (~400-500 KB gz)
        // at the cost of more, smaller chunks (fine over HTTP/2).
        // scripts/check-widget-bundle.ts guards the widget's eager graph in CI.
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      stubServerLoggerInClient(),
      tailwindcss(),
      nitro({
        preset: 'bun',
      }),
      tanstackStart({
        srcDirectory: 'src',
        router: {
          routesDirectory: 'routes',
          routeFileIgnorePattern: '__tests__',
        },
        importProtection: {
          behavior: { dev: 'error', build: 'error' },
          client: {
            specifiers: [
              'postgres',
              '@quackback/db',
              '@quackback/db/client',
              '@quackback/db/schema',
              'bullmq',
              'ioredis',
              'openai',
              '@quackback/logger',
              'pino',
            ],
          },
        },
      }),
      viteReact(),
    ].filter(Boolean) as PluginOption[],
  }
})
