import { memo } from 'react'
import { useIntl } from 'react-intl'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { MessageMarkdown } from '@/components/shared/conversation/message-markdown'
import type {
  WorkspaceCopilotFinalPayload,
  WorkspaceCopilotMessage,
  WorkspaceCopilotThreadSummary,
} from '@/lib/shared/assistant/workspace-contract'
import type { JsonValue } from '@/lib/shared/json'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import { WorkingSteps } from './working-steps'
import { ChatHistory } from './chat-history'
import { WorkspaceAssistantMessage } from './workspace-assistant-message'
import { WorkspaceSettingsProposalCard } from './workspace-settings-proposal-card'
import { ConnectorCallCard } from './connector-call-card'
export type DraftTurn = {
  threadKey: string
  question: string
  text: string
  activities?: AssistantActivityStatus[]
  final?: WorkspaceCopilotFinalPayload
}
const EMPTY_CITATIONS: JsonValue[] = []
export function WorkspaceChatThread({
  title,
  threads,
  busy,
  messages,
  draft,
  loadFailed,
  error,
  onBack,
  onNewChat,
  onOpenThread,
  onNavigate,
  onConnectorAllowed,
  onRetry,
}: {
  title: string
  threads: WorkspaceCopilotThreadSummary[]
  busy: boolean
  messages: WorkspaceCopilotMessage[]
  draft: DraftTurn | null
  loadFailed: boolean
  error: string | null
  onBack: () => void
  onNewChat: () => void
  onOpenThread: (key: string) => void
  onNavigate: (href: string) => void
  onConnectorAllowed: (connectorName: string) => void
  onRetry: () => void
}) {
  const intl = useIntl()
  const userBubble = 'ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 sm:max-w-[80%]'
  return (
    <>
      <header className="sticky top-0 z-10 -mx-4 flex h-14 shrink-0 items-center gap-2 bg-background px-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-background after:to-transparent sm:-mx-6 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground focus-visible:ring-muted-foreground"
          onClick={onBack}
          aria-keyshortcuts="Escape"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {intl.formatMessage({ id: 'ask.chat.back', defaultMessage: 'Back' })}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium">{title}</h1>
        {threads.length > 0 && (
          <ChatHistory threads={threads} onOpenThread={onOpenThread} compact />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          className="focus-visible:ring-muted-foreground"
          onClick={onNewChat}
        >
          {intl.formatMessage({ id: 'ask.chat.newChat', defaultMessage: 'New chat' })}
        </Button>
      </header>
      <section
        aria-label={intl.formatMessage({ id: 'ask.chat.section', defaultMessage: 'Chat' })}
        className="space-y-8 py-6"
      >
        {loadFailed && (
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'ask.settings.unavailable',
              defaultMessage: 'These changes are unavailable.',
            })}
          </p>
        )}
        <SavedChatMessages
          messages={messages}
          onNavigate={onNavigate}
          onConnectorAllowed={onConnectorAllowed}
        />
        {draft && (
          <>
            {!(
              messages.at(-1)?.sender === 'customer' && messages.at(-1)?.text === draft.question
            ) && (
              <div className={userBubble}>
                <MessageMarkdown text={draft.question} />
              </div>
            )}
            <div className="space-y-3 leading-7" aria-busy={busy}>
              <WorkingSteps steps={draft.activities ?? []} busy={busy} answering={!!draft.text} />
              {draft.text ? (
                <WorkspaceAssistantMessage
                  text={draft.text}
                  citations={draft.final?.citations ?? EMPTY_CITATIONS}
                  streaming={busy}
                />
              ) : (
                busy &&
                !draft.activities?.length && (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage({ id: 'ask.chat.thinking', defaultMessage: 'Thinking…' })}
                  </p>
                )
              )}
              <ChatActions
                final={draft.final}
                onNavigate={onNavigate}
                onConnectorAllowed={onConnectorAllowed}
              />
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
            <Button variant="ghost" size="sm" onClick={onRetry} disabled={busy}>
              {intl.formatMessage({ id: 'ask.search.retry', defaultMessage: 'Retry' })}
            </Button>
          </p>
        )}
      </section>
    </>
  )
}

function ChatActions({
  final,
  onNavigate,
  onConnectorAllowed,
}: {
  final?: WorkspaceCopilotFinalPayload
  onNavigate: (href: string) => void
  onConnectorAllowed: (name: string) => void
}) {
  const intl = useIntl()
  return final ? (
    <>
      {final.proposedActions.map((action) =>
        action.toolName === 'propose_settings_change' ? (
          <WorkspaceSettingsProposalCard key={action.id} action={action} />
        ) : action.connector ? (
          <ConnectorCallCard
            key={action.id}
            action={{ ...action, connector: action.connector }}
            onAllowed={onConnectorAllowed}
          />
        ) : (
          <p key={action.id} className="text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'ask.settings.unavailable',
              defaultMessage: 'These changes are unavailable.',
            })}
          </p>
        )
      )}
      {final.navigation.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {final.navigation.map((link) => (
            <Button
              key={link.href}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onNavigate(link.href)}
              className="bg-card shadow-raise transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:shadow-raise-hover focus-visible:ring-muted-foreground"
            >
              {link.messageId
                ? intl.formatMessage({ id: link.messageId, defaultMessage: link.label })
                : link.label}
            </Button>
          ))}
        </div>
      )}
    </>
  ) : null
}
const SavedChatMessages = memo(function SavedChatMessages({
  messages,
  onNavigate,
  onConnectorAllowed,
}: {
  messages: WorkspaceCopilotMessage[]
  onNavigate: (href: string) => void
  onConnectorAllowed: (name: string) => void
}) {
  return (
    <>
      {messages.map((message) => (
        <div
          key={message.id}
          className={
            message.sender === 'customer'
              ? 'ms-auto w-fit max-w-[90%] rounded-2xl bg-muted px-4 py-3 sm:max-w-[80%]'
              : 'space-y-3 leading-7'
          }
        >
          {message.sender === 'assistant' ? (
            <WorkspaceAssistantMessage
              text={message.text}
              citations={message.payload?.citations ?? EMPTY_CITATIONS}
            />
          ) : (
            <MessageMarkdown text={message.text} />
          )}
          <ChatActions
            final={message.payload}
            onNavigate={onNavigate}
            onConnectorAllowed={onConnectorAllowed}
          />
        </div>
      ))}
    </>
  )
})
