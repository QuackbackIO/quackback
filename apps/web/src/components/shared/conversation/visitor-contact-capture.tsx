import { FormattedMessage, useIntl } from 'react-intl'
import { looksLikeContactEmail } from '@/lib/shared/contact-capture'

export interface VisitorContactCaptureProps {
  required: boolean
  askName: boolean
  email: string
  name: string
  onEmailChange: (value: string) => void
  onNameChange: (value: string) => void
  onSkip?: () => void
}

export function contactCaptureReady(opts: { required: boolean; email: string }): boolean {
  if (!opts.required && !opts.email.trim()) return true
  return looksLikeContactEmail(opts.email)
}

export function VisitorContactCapture({
  required,
  askName,
  email,
  name,
  onEmailChange,
  onNameChange,
  onSkip,
}: VisitorContactCaptureProps) {
  const intl = useIntl()

  return (
    <div className="space-y-2 border-b border-border/40 px-3 py-2.5">
      <p className="text-xs font-medium text-foreground">
        {required ? (
          <FormattedMessage
            id="widget.contactCapture.headingRequired"
            defaultMessage="Leave your email so we can get back to you"
          />
        ) : (
          <FormattedMessage
            id="widget.contactCapture.headingOptional"
            defaultMessage="Want a reply by email?"
          />
        )}
      </p>
      {askName && (
        <input
          aria-label={intl.formatMessage({
            id: 'widget.contactCapture.nameLabel',
            defaultMessage: 'Your name (optional)',
          })}
          type="text"
          autoComplete="name"
          maxLength={80}
          placeholder={intl.formatMessage({
            id: 'widget.contactCapture.namePlaceholder',
            defaultMessage: 'Your name',
          })}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full min-w-0 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
        />
      )}
      <input
        aria-label={intl.formatMessage({
          id: 'widget.contactCapture.emailLabel',
          defaultMessage: 'Your email',
        })}
        aria-invalid={!!email.trim() && !looksLikeContactEmail(email)}
        type="email"
        autoComplete="email"
        required={required}
        maxLength={254}
        placeholder={intl.formatMessage({
          id: 'widget.contactCapture.emailPlaceholder',
          defaultMessage: 'you@example.com',
        })}
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
      />
      {email.trim() && !looksLikeContactEmail(email) && (
        <p role="alert" className="text-xs text-destructive">
          <FormattedMessage
            id="widget.contactCapture.invalidEmail"
            defaultMessage="Enter a valid email address."
          />
        </p>
      )}
      {!required && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <FormattedMessage id="widget.contactCapture.skip" defaultMessage="Skip" />
        </button>
      )}
    </div>
  )
}
