import { useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { deleteTestConversationsFn } from '@/lib/server/functions/test-customer'

/** The Test view's header: what happens to test threads, and a way to clear them now. */
export function TestViewHeader({ onDeleted }: { onDeleted: () => void }) {
  const intl = useIntl()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteTestConversationsFn(),
    onSuccess: ({ deleted }) => {
      setConfirming(false)
      toast.success(
        intl.formatMessage(
          {
            id: 'inbox.test.deleted',
            defaultMessage:
              '{count, plural, one {# test conversation} other {# test conversations}} deleted',
          },
          { count: deleted }
        )
      )
      onDeleted()
    },
  })
  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
      <p className="text-xs text-muted-foreground">
        <FormattedMessage
          id="inbox.test.retention"
          defaultMessage="Deleted automatically after 7 days."
        />
      </p>
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        <FormattedMessage id="inbox.test.delete" defaultMessage="Delete test conversations" />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={intl.formatMessage({
          id: 'inbox.test.confirmTitle',
          defaultMessage: 'Delete all test conversations?',
        })}
        description={intl.formatMessage({
          id: 'inbox.test.confirmBody',
          defaultMessage: 'Real conversations are not affected.',
        })}
        confirmLabel={intl.formatMessage({ id: 'inbox.test.confirm', defaultMessage: 'Delete' })}
        cancelLabel={intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync()
        }}
      />
    </div>
  )
}
