'use client'

import { useIntl } from 'react-intl'
import { SecretRevealDialog } from '@/components/shared/secret-reveal-dialog'
import { ADMIN_KEY_MESSAGES, type KeyDialogMessages } from './key-messages'

interface ApiKeyRevealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keyValue: string | null
  keyName: string
  onClose?: () => void
  messages?: KeyDialogMessages
}

export function ApiKeyRevealDialog({
  open,
  onOpenChange,
  keyValue,
  keyName,
  onClose,
  messages = ADMIN_KEY_MESSAGES,
}: ApiKeyRevealDialogProps) {
  const intl = useIntl()
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onClose?.()
    }
    onOpenChange(newOpen)
  }

  return (
    <SecretRevealDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={intl.formatMessage(messages.revealTitle)}
      description={intl.formatMessage(messages.revealDescription, {
        name: <strong>{keyName}</strong>,
      })}
      secretLabel={intl.formatMessage(messages.revealSecretLabel)}
      secretValue={keyValue}
      confirmLabel={intl.formatMessage(messages.revealConfirm)}
      warningTitle={intl.formatMessage(messages.revealCopyTitle)}
      warningDescription={intl.formatMessage(messages.revealCopyDescription)}
      copyLabel={intl.formatMessage(messages.revealCopy)}
    >
      {/* Usage example */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{intl.formatMessage(messages.revealUsage)}</label>
        <div className="rounded-lg bg-muted p-3">
          <code className="ph-mask text-xs text-muted-foreground block">
            curl -H &quot;Authorization: Bearer {keyValue ? keyValue.slice(0, 20) + '...' : ''}
            &quot; \
            <br />
            &nbsp;&nbsp;https://yoursite.com/api/v1/posts
          </code>
        </div>
      </div>
    </SecretRevealDialog>
  )
}
