/**
 * Suggestion generation prompt.
 *
 * Generates a post title and body from a feedback signal when no
 * similar existing post is found (create_post suggestions).
 */

interface SuggestionPromptInput {
  signal: {
    signalType: string
    summary: string
    implicitNeed?: string
    evidence: string[]
  }
  sourceContent: {
    subject?: string
    text?: string
  }
  boards: Array<{ id: string; name: string; slug: string }>
}

export function buildSuggestionPrompt(input: SuggestionPromptInput): string {
  const { signal, sourceContent, boards } = input

  const boardList = boards.map((b) => `- ${b.name} (id: ${b.id})`).join('\n')

  return `You are a product manager reviewing customer feedback. Generate a concise post for the product feedback board.

## Source feedback
${sourceContent.subject ? `Subject: ${sourceContent.subject}` : ''}
${sourceContent.text ? `Content: ${sourceContent.text}` : ''}

## Extracted signal
Type: ${signal.signalType}
Summary: ${signal.summary}
${signal.implicitNeed ? `Implicit need: ${signal.implicitNeed}` : ''}
${signal.evidence.length > 0 ? `Evidence:\n${signal.evidence.map((e) => `- "${e}"`).join('\n')}` : ''}

## Available boards
${boardList}

## Instructions
Generate a post that captures the customer's feedback clearly and concisely.

Rules:
- Title: 5-15 words, actionable, starts with a verb (e.g. "Add", "Fix", "Improve")
- Body: 1-3 sentences expanding on the need. Reference the original feedback naturally.
- Board: Pick the most relevant board from the list, or null if none fit
- Reasoning: Brief explanation of why this feedback warrants a new post

Respond with valid JSON only:
{
  "title": "string",
  "body": "string",
  "boardId": "string | null",
  "reasoning": "string"
}`
}
