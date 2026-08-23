import { toast } from 'sonner'

/** State a public-surface change. No-op when the goal turned nothing new on. */
export function toastEnabledModules(modules: readonly string[]): void {
  if (modules.length === 1) {
    toast.success(`${modules[0]} turned on`)
    return
  }
  if (modules.length > 1) {
    toast.success(`Turned on ${modules.join(', ')}`)
  }
}
