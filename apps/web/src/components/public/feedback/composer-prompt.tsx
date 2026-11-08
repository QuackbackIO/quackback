import type { ReactNode } from 'react'
import { usePreviewSamples } from '@/components/public/preview-draft-context'

/**
 * The composer's title field with its prompt. In the builder the prompt is
 * drawn as words over the empty field, marked so a double-click edits it
 * where it sits (a field's placeholder cannot be); everywhere else the field
 * shows it as its placeholder.
 */
export function ComposerPrompt({
  prompt,
  children,
}: {
  prompt: string
  /** The field, given the placeholder it shows. */
  children: (placeholder: string) => ReactNode
}) {
  return composerPromptField(usePreviewSamples(), prompt, children)
}

/**
 * The same, as a plain function for a field that renders on every keystroke:
 * a wrapper component there would render again with it each time. The caller
 * reads `designing` from usePreviewSamples.
 */
export function composerPromptField(
  designing: boolean,
  prompt: string,
  children: (placeholder: string) => ReactNode
): ReactNode {
  if (!designing) return children(prompt)
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      {children('')}
      <span
        data-qb-words="feedback.prompt"
        className="absolute inset-0 flex items-center truncate font-normal text-muted-foreground"
      >
        {prompt}
      </span>
    </span>
  )
}
