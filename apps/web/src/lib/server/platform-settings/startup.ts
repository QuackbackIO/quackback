import { overlayPlatformSettings } from '../../shared/platform-settings'
export interface StartupSettingsDeps {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  pause(milliseconds: number): Promise<void>
}
const defaults: StartupSettingsDeps = {
  fetch: globalThis.fetch,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
/** Runs before any application module, migration, worker or server is initialized. */
export async function loadCloudEnvironment(
  environment: Record<string, string | undefined>,
  deps = defaults
) {
  if (environment.QUACKBACK_TENANCY !== 'pooled') return { ...environment }
  let origin: URL
  try {
    origin = new URL(environment.QUACKBACK_CONTROL_PLANE_URL ?? '')
  } catch {
    throw new Error('Cloud settings require QUACKBACK_CONTROL_PLANE_URL')
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Cloud settings require an HTTPS control-plane origin')
  const token = environment.QUACKBACK_CP_SETTINGS_TOKEN
  if (!token || token.length < 32)
    throw new Error('Cloud settings require QUACKBACK_CP_SETTINGS_TOKEN (32+ characters)')
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response
    try {
      response = await deps.fetch(new URL('/api/v1/internal/platform-settings', origin), {
        headers: { authorization: 'Bearer ' + token },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      if (attempt < 2) {
        await deps.pause(500 * (attempt + 1))
        continue
      }
      throw new Error('Cloud settings could not be loaded; application startup refused')
    }
    if (!response.ok) {
      await response.body?.cancel()
      if ((response.status >= 500 || response.status === 429) && attempt < 2) {
        await deps.pause(500 * (attempt + 1))
        continue
      }
      throw new Error(
        'Cloud settings request failed (HTTP ' + response.status + '); application startup refused'
      )
    }
    try {
      const reader = response.body?.getReader()
      if (!reader) throw new Error()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1048576) {
            await reader.cancel()
            throw new Error()
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error()
      return overlayPlatformSettings(environment, body.settings)
    } catch {
      throw new Error('Cloud settings response is invalid; application startup refused')
    }
  }
  throw new Error('Cloud settings unavailable')
}
