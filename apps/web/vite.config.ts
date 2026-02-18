import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
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
      port: 3000,
      allowedHosts: true,
      hmr: {
        overlay: false,
      },
    },
    build: {
      rollupOptions: {
        // TanStack Router SSR code imports node builtins (node:stream, node:async_hooks)
        // that end up in the client bundle. Vite 7 errors on named imports from
        // browser-externalized modules. Mark node: imports as external since they're
        // SSR-only code paths that never execute in the browser.
        external: [/^node:/],
      },
    },
    plugins: [
      tailwindcss(),
      tsconfigPaths({
        projects: ['./tsconfig.json'],
      }),
      nitro({
        preset: 'bun',
      }),
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
