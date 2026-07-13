/**
 * Drawer for inspecting webhook delivery attempts. Opens when `webhook` is
 * non-null; closes when `onOpenChange(false)` is called.
 */
import { useState, Suspense } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { WebhookId } from '@quackback/ids'
import type { Webhook } from '@/lib/shared/types'
import type { WebhookDeliveryStatusFilter } from '@/lib/client/queries/webhook-deliveries'
import { WebhookDeliveriesTable } from './webhook-deliveries-table'

interface Props {
  webhook: Webhook | null
  onOpenChange: (open: boolean) => void
}

const ALL = '__all__'

export function WebhookDeliveriesDrawer({ webhook, onOpenChange }: Props) {
  const [status, setStatus] = useState<WebhookDeliveryStatusFilter | undefined>(undefined)

  return (
    <Sheet open={!!webhook} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Deliveries</SheetTitle>
          <SheetDescription className="truncate" title={webhook?.url}>
            {webhook?.url ?? ''}
          </SheetDescription>
        </SheetHeader>

        {webhook && (
          <div className="space-y-4 py-4 px-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Status:</Label>
              <Select
                value={status ?? ALL}
                onValueChange={(v) =>
                  setStatus(v === ALL ? undefined : (v as WebhookDeliveryStatusFilter))
                }
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed_retryable">Retrying</SelectItem>
                  <SelectItem value="failed_terminal">Failed</SelectItem>
                  <SelectItem value="blocked_ssrf">Blocked (SSRF)</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Suspense fallback={<div className="text-xs text-muted-foreground">Loading…</div>}>
              <WebhookDeliveriesTable webhookId={webhook.id as WebhookId} status={status} />
            </Suspense>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
