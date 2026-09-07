# Slack workspace assistant

Quackback answers linked teammates in channel threads and DMs, and proposes feedback posts or internal tickets for a teammate to approve. It uses the workspace assistant configuration under **AI & Automation → Workspace assistant**. Customer support and Copilot settings remain separate. The Slack deployment is off by default.

## Self-hosted setup

1. Create a Slack app from [the manifest](./slack-app-manifest.json). Replace the OAuth redirect URL with `https://YOUR_HOST/oauth/slack/callback`.
2. Replace the events, interactions, commands and options URLs with `https://YOUR_HOST/api/integrations/slack/hooks/events`, `/interactions`, `/commands` and `/options` respectively. Keep the last path segment specific to each URL.
3. Under Settings → Integrations → Slack, save the app's Client ID, Client Secret and Signing Secret. Leave `INTEGRATION_OAUTH_GATEWAY_URL` unset. Single tenancy accepts direct Slack signatures without gateway authentication.
4. Connect Slack. If already connected, reconnect to grant the assistant scopes. Enable **AI assistant in Slack** on the integration card.
5. Invite the app to a channel and mention it in a thread, DM it, or use `/quackback`. The **Send to Quackback** message shortcut proposes feedback. The slash command responds ephemerally.

A Slack user's email must match exactly one verified Quackback member or administrator. Existing links are checked against current membership on every turn. Deleted users, bots, ambiguous emails and former members do not gain team knowledge. Custom Quackback permissions govern assistant use and approval. Manual linking and public answers for unlinked users are not included.

The **Approve** and **Reject** buttons check the acting member's permissions. Writes always require approval. Conversation-only controls and connector writes are unavailable on Slack in this release. Tickets created from Slack are internal back-office tickets. Feedback citations and links respect the tenant host.

## Slack platform configuration

The manifest uses `features.agent_view.agent_description`; the current manifest reference does not list an `enabled` field. Enable the agent experience in the Slack console and confirm the app has `assistant:write`. OAuth requests explicitly include and validate `assistant:write` alongside the other required bot scopes.

Status calls use `agents.sessions.setStatus` with `channel_id`. Suggested prompts use `assistant.threads.setSuggestedPrompts` without `thread_ts` for the agent view. Feedback buttons use `context_actions`. References checked 2026-09-05: [manifest](https://docs.slack.dev/reference/app-manifest/), [agent sessions](https://docs.slack.dev/ai/agent-sessions/), [suggested prompts](https://docs.slack.dev/reference/methods/assistant.threads.setSuggestedPrompts/), [feedback buttons](https://docs.slack.dev/reference/block-kit/block-elements/feedback-buttons-element/).

`agent_session_stopped` is subscribed so Slack shows a native Stop button while the session is `processing`. The HTTP ack aborts the in-flight turn immediately (the `slack-hook` queue is serial and would otherwise wait). The worker then sets the session `active` and confirms. Native title-change and contextual channel events remain omitted rather than displaying controls with no handler. Options return an empty synchronous list because v1 has no remote-select controls. Enterprise Grid org installs, token rotation and Socket Mode are disabled.

## Cloud deployment

See [the integration gateway runbook](./integration-gateway-rollout.md). The shared app uses the manifest's `app.quackback.io` URLs. Every workspace database keeps its own assistant configuration, member links, pending actions and deduplication receipts. Shared OAuth client/signing credentials are Railway environment variables on CP and the fleet. Tenant installation tokens remain isolated in workspace databases.
