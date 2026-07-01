/** Three bouncing dots for a conversation "is typing…" indicator. */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1 rounded-full bg-current animate-bounce" />
    </span>
  )
}
