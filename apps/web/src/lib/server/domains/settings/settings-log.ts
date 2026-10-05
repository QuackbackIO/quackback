import { NotFoundError } from '@/lib/shared/errors'

interface SettingsLogger {
  error: (obj: Record<string, unknown>, msg: string) => void
  debug: (obj: Record<string, unknown>, msg: string) => void
}

/**
 * True for the refusal a settings read throws while the workspace has no
 * settings row yet, which is the state of a fresh install until onboarding
 * completes.
 */
export function isSettingsNotYetCreated(err: unknown): boolean {
  return err instanceof NotFoundError && err.code === 'SETTINGS_NOT_FOUND'
}

/**
 * Log a failed settings operation. The not-yet-onboarded case is expected
 * during sign-up and logs at debug; everything else is an error.
 */
export function logSettingsError(log: SettingsLogger, err: unknown, msg: string): void {
  if (isSettingsNotYetCreated(err)) log.debug({ err }, msg)
  else log.error({ err }, msg)
}
