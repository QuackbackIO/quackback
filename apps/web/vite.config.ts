import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

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
        output: {
          // TanStack Router auto-splits each route file into its own chunk.
          // For a page like the public portal that's ~120 modulepreload links
          // per render — each tiny, each costing a parse + HTTP round-trip.
          // Collapse routes (and their per-section component trees) into one
          // chunk per top-level segment so a single portal render fetches a
          // handful of larger chunks instead of dozens of micro-ones. Browser
          // cache benefits stay intact (the per-segment chunk is invalidated
          // only when something inside it changes), but cold-page modulepreload
          // count drops sharply.
          manualChunks: (id: string) => {
            // Only apply to first-party code under src/. node_modules vendor
            // splitting (react, react-dom, etc.) is left to the default heuristics.
            if (!id.includes('/src/')) return undefined

            // Files dynamically imported via React.lazy() to defer heavy
            // client-only deps (framer-motion, recharts) MUST stay in their
            // own auto-split chunks. Otherwise manualChunks coalesces them
            // back into the parent route bundle and the lazy() boundary is
            // lost — the heavy lib gets statically imported by the SSR
            // entry chunk again. Returning undefined here lets Rollup
            // honour the dynamic-import boundary.
            if (
              id.endsWith('-animated.tsx') ||
              id.endsWith('/analytics-activity-chart.tsx') ||
              id.endsWith('/analytics-status-chart.tsx') ||
              id.endsWith('/components/ui/chart.tsx') ||
              id.endsWith('/components/public/similar-posts-card.tsx')
            ) {
              return undefined
            }

            // Lowercase-only on purpose — fail fast if a route/component dir
            // is renamed to something with capitals so the chunk name doesn't
            // silently diverge.
            const routeMatch = id.match(/\/src\/routes\/(_?[a-z][a-z0-9-]*)/)
            if (routeMatch) {
              // Strip leading underscore so '_portal' and 'portal' bundle together.
              return `route-${routeMatch[1].replace(/^_/, '')}`
            }

            // Sub-group components/admin/* by second segment so the admin
            // tree (~1.6 MB of source) splits per-section — admin/settings,
            // admin/feedback, admin/help-center, admin/users — instead of
            // shipping as one monolithic chunk that all admin routes parse.
            const adminMatch = id.match(/\/src\/components\/admin\/([a-z][a-z0-9-]*)/)
            if (adminMatch) {
              return `components-admin-${adminMatch[1]}`
            }

            const componentMatch = id.match(/\/src\/components\/([a-z][a-z0-9-]*)/)
            if (componentMatch) {
              return `components-${componentMatch[1]}`
            }

            return undefined
          },
        },
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
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
            ],
          },
        },
      }),
      viteReact(),
    ].filter(Boolean) as PluginOption[],
  }
})
