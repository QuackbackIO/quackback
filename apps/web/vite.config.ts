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

/**
 * Dev only: keep SSR-only bare imports out of the CLIENT dependency optimizer.
 *
 * To inline route CSS into dev SSR HTML, TanStack Start's dev-server plugin
 * serves `/@tanstack-start/styles.css?routes=…` by crawling the SSR module
 * graph (`start-plugin-core/src/vite/dev-server-plugin/dev-styles.ts`,
 * `findModuleDeps`). It looks every SSR dep up through the mixed
 * `server.moduleGraph.getModuleByUrl`, which resolves the URL in the client
 * environment as well. Server-only packages reached that way (`pino`,
 * `jose/errors`, `postgres`, …) have no client importer, but Vite's resolver
 * still registers them as newly discovered client deps → re-bundle →
 * "optimized dependencies changed. reloading". Any route chunk in flight at
 * that moment fails with `504 Outdated Optimize Dep` / "Failed to fetch
 * dynamically imported module", which is the blank page seen when clicking
 * into /admin from the portal right after the dev server starts or the deps
 * cache is invalidated.
 *
 * A real client import always carries its importing module, whereas Vite's
 * plugin container substitutes `<root>/index.html` when a lookup has no
 * importer (`EnvironmentPluginContainer.resolveId`); the optimizer's own scan
 * additionally passes `scan: true`. So a bare specifier resolved in the client
 * environment with that placeholder importer and no scan flag can only be the
 * crawl. Answer it with an inert virtual module: the crawl still gets a node
 * (with nothing to descend into) and the optimizer never hears about the
 * package. Stylesheet specifiers are left alone — the crawl needs those (e.g.
 * `@fontsource/…/400.css`) to resolve to real files so the CSS is inlined — as
 * are ids with a scheme (`virtual:`, `node:`), which belong to other plugins
 * or the browser-external shim. Production builds are untouched (`apply:
 * 'serve'`); the upstream fix is for the crawl to use the SSR environment's
 * own module graph.
 */
function keepSsrOnlyDepsOutOfClientOptimizer(): PluginOption {
  const VIRTUAL_PREFIX = '\0quackback:ssr-only-dep:'
  // Same shape as Vite's bareImportRE: a package name, not a path.
  const bareSpecifierRE = /^[\w@][^:]*$/
  const stylesheetRE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/
  return {
    name: 'quackback:keep-ssr-only-deps-out-of-client-optimizer',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id, importer, options) {
      if (this.environment?.name !== 'client' || options.scan) return null
      const placeholderImporter = path.join(this.environment.config.root, 'index.html')
      if (importer !== undefined && importer !== placeholderImporter) return null
      if (!bareSpecifierRE.test(id) || stylesheetRE.test(id)) return null
      return VIRTUAL_PREFIX + id
    },
    load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) return 'export {}'
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
      host: true,
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
      keepSsrOnlyDepsOutOfClientOptimizer(),
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
