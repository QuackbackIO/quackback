import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env from monorepo root where .env file lives
  loadEnv(mode, path.resolve(__dirname, '../../'), '')

  return {
    server: {
      port: 3000,
      allowedHosts: true,
      hmr: {
        overlay: false,
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
