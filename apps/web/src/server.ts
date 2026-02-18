import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { logStartupBanner } from '@/lib/server/startup'

logStartupBanner()

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
