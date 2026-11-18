/**
 * Start the production build (`.output/server/index.mjs`) for the support
 * suite, with exactly the suite's environment (support.env plus derived
 * values) and nothing from the developer's shell or repo-root .env beyond PATH
 * and HOME. Run by playwright.support.config.ts as its app webServer.
 *
 * Build first: `bun run --filter @quackback/widget build && bun run build`.
 */
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { resolve } from 'node:path'
import { SUPPORT_RUN_DIR, supportEnv } from './env'
import { ensureSinkCertificate } from './stand-ins/tls'

const appDir = resolve(import.meta.dir, '../..')
const entry = resolve(appDir, '.output/server/index.mjs')
if (!existsSync(entry)) {
  process.stderr.write(
    `No production build at ${entry}. Run \`bun run build\` in apps/web first.\n`
  )
  process.exit(1)
}

const env = supportEnv()
ensureSinkCertificate(env.sinkCertPath, env.sinkKeyPath)

// The server log goes to a file (CI uploads it when a run fails) rather than
// into the test output.
mkdirSync(SUPPORT_RUN_DIR, { recursive: true })
const logPath = resolve(SUPPORT_RUN_DIR, 'app.log')
const logFd = openSync(logPath, 'a')
process.stdout.write(`support app: ${env.baseUrl}, log ${logPath}\n`)

const server = Bun.spawn(['bun', entry], {
  cwd: appDir,
  env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env.app },
  stdout: logFd,
  stderr: logFd,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.kill(signal)
  })
}
const code = await server.exited
closeSync(logFd)
process.exit(code)
