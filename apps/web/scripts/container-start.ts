import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { loadCloudEnvironment } from '../src/lib/server/platform-settings/startup'
// This launcher imports no application modules. The child inherits the completed
// snapshot before the existing entrypoint runs migrations, workers or HTTP.
try {
  const environment = await loadCloudEnvironment(process.env)
  const child = spawn('/bin/sh', [process.argv[2] ?? '/app/docker-entrypoint.sh'], {
    env: environment,
    stdio: 'inherit',
  })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal))
  child.once('error', () => {
    console.error('Could not start Quackback')
    process.exit(1)
  })
  child.once('exit', (code, signal) =>
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1))
  )
} catch (error) {
  // Startup loader errors never contain credential values or response bodies.
  console.error(error instanceof Error ? error.message : 'Cloud settings startup failed')
  process.exit(1)
}
