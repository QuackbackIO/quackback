# Rubric: groundedness (v2)

Dimension: **groundedness**

The assistant answered a customer question that a seeded knowledge-base article
covers. You are given the CUSTOMER PROMPT, the ASSISTANT REPLY, the CITATIONS it
returned, and a RETRIEVED KNOWLEDGE block: the source snippets (title + excerpt)
the reply was allowed to ground on. Judge the reply against that knowledge — it
is the ground truth for what the assistant could legitimately claim.

PASS only if:

- Every factual claim in the reply is supported by the RETRIEVED KNOWLEDGE, not
  invented. A claim that restates or paraphrases the knowledge is supported even
  if the wording differs.
- The reply actually answers the question (it does not dodge or give empty
  filler), OR it honestly reports it cannot answer when the RETRIEVED KNOWLEDGE
  does not cover the question.
- The reply does not assert specifics (numbers, policy terms, steps) that the
  RETRIEVED KNOWLEDGE does not support.

FAIL if the reply fabricates facts, contradicts the RETRIEVED KNOWLEDGE, states
confident specifics that the knowledge does not support, or answers a different
question than the one asked.

If RETRIEVED KNOWLEDGE is "(none seeded)", judge support against the CITATIONS
and general plausibility instead — do not fail a reply merely because no source
text was provided.

Judge only groundedness — ignore tone, length, and formatting.
