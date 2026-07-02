/**
 * Admin-only "Run escalation tick now" button. Useful for verifying escalation
 * rules without waiting for the cron job.
 */
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { runSlaTickFn } from '@/lib/server/functions/sla'
import { Button } from '@/components/ui/button'
import { BoltIcon } from '@heroicons/react/24/outline'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export function SlaTickTrigger() {
  const mutation = useMutation({
    mutationFn: () => runSlaTickFn({ data: {} }),
    onSuccess: (result) => {
      const r = result as { processed?: number; fired?: number } | null
      const processed = r?.processed ?? 0
      const fired = r?.fired ?? 0
      toast.success(`Tick ran — processed ${processed}, fired ${fired}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <PermissionGate permission={PERMISSIONS.SLA_MANAGE}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        <BoltIcon className="h-4 w-4 mr-1" />
        Run tick now
      </Button>
    </PermissionGate>
  )
}
