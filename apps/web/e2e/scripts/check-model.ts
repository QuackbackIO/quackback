/**
 * CLI: print whether the dev server's environment configures a chat model for
 * Copilot (an OpenAI-compatible key, base URL and a chat or assistant model).
 * Copilot specs stub every model turn; they only need the server to offer chat.
 */
const configured = Boolean(
  process.env.OPENAI_API_KEY &&
  process.env.OPENAI_BASE_URL &&
  (process.env.AI_ASSISTANT_MODEL || process.env.AI_CHAT_MODEL)
)
console.log(JSON.stringify({ configured }))
