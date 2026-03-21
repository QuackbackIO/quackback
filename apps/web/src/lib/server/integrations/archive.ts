/**
 * Platform archive/close functions for cascading post deletes.
 *
 * Each function closes or archives a linked issue in an external tracker.
 * All functions handle errors gracefully -- failures are warnings, not blockers.
 */

// ============================================================================
// Types
// ============================================================================

export interface ArchiveResult {
  success: boolean
  action?: 'closed' | 'archived'
  error?: string
}

export interface ArchiveContext {
  externalId: string
  externalUrl?: string | null
  accessToken: string
  integrationConfig: Record<string, unknown>
}

// ============================================================================
// Helpers
// ============================================================================

const ARCHIVE_TIMEOUT_MS = 10_000

/** Check common HTTP error statuses; returns null if response should be processed normally. */
async function handleErrorStatus(
  response: Response,
  platform: string,
  action: 'closed' | 'archived'
): Promise<ArchiveResult | null> {
  if (response.status === 401) {
    response.body?.cancel()
    return { success: false, error: 'Auth expired' }
  }
  if (response.status === 404) {
    response.body?.cancel()
    return { success: true, action }
  }
  if (!response.ok) {
    const text = await response.text()
    return { success: false, error: `${platform} API ${response.status}: ${text.slice(0, 200)}` }
  }
  return null
}

// ============================================================================
// Registry
// ============================================================================

const archiveFns: Record<string, (ctx: ArchiveContext) => Promise<ArchiveResult>> = {
  linear: archiveLinearIssue,
  github: closeGitHubIssue,
  jira: closeJiraIssue,
  gitlab: closeGitLabIssue,
  clickup: closeClickUpTask,
  asana: completeAsanaTask,
  shortcut: archiveShortcutStory,
  azure_devops: closeAzureDevOpsWorkItem,
  trello: archiveTrelloCard,
  notion: archiveNotionPage,
  monday: archiveMondayItem,
}

/**
 * Archive or close a linked external issue.
 * Returns a result indicating success or failure -- never throws.
 */
export async function archiveExternalIssue(
  integrationType: string,
  ctx: ArchiveContext
): Promise<ArchiveResult> {
  const fn = archiveFns[integrationType]
  if (!fn) {
    return { success: false, error: `Unsupported integration type: ${integrationType}` }
  }
  try {
    return await fn(ctx)
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Platform Functions
// ============================================================================

const LINEAR_API = 'https://api.linear.app/graphql'

async function archiveLinearIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation ArchiveIssue($id: String!) { issueArchive(id: $id) { success } }`,
      variables: { id: ctx.externalId },
    }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Linear', 'archived')
  if (err) return err

  const json = (await response.json()) as {
    data?: { issueArchive?: { success: boolean } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}

const GITHUB_API = 'https://api.github.com'

async function closeGitHubIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const ownerRepo = extractGitHubOwnerRepo(ctx.externalUrl)
  if (!ownerRepo) return { success: false, error: 'Cannot determine repo from external URL' }

  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ state: 'closed' }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  if (response.status === 422) {
    response.body?.cancel()
    return { success: true, action: 'closed' } // already closed
  }
  const err = await handleErrorStatus(response, 'GitHub', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function extractGitHubOwnerRepo(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues/)
  return match?.[1] ?? null
}

async function closeJiraIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const cloudId = ctx.integrationConfig.cloudId as string
  if (!cloudId) return { success: false, error: 'Missing Jira cloudId' }

  const baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
  const headers = {
    Authorization: `Bearer ${ctx.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const transRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, {
    headers,
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })
  const transErr = await handleErrorStatus(transRes, 'Jira', 'closed')
  if (transErr) return transErr

  const transData = (await transRes.json()) as {
    transitions: Array<{ id: string; name: string; to: { statusCategory: { key: string } } }>
  }

  const terminal = transData.transitions.find((t) => t.to.statusCategory.key === 'done')
  if (!terminal) {
    return { success: false, error: 'No terminal transition found (Done/Closed)' }
  }

  const execRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transition: { id: terminal.id } }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  if (!execRes.ok) {
    return { success: false, error: `Jira transition failed: ${execRes.status}` }
  }
  return { success: true, action: 'closed' }
}

const GITLAB_API = 'https://gitlab.com/api/v4'

async function closeGitLabIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const projectId = extractGitLabProjectId(ctx.externalUrl)
  if (!projectId) return { success: false, error: 'Cannot determine project from external URL' }

  const response = await fetch(
    `${GITLAB_API}/projects/${encodeURIComponent(projectId)}/issues/${ctx.externalId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state_event: 'close' }),
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    }
  )

  const err = await handleErrorStatus(response, 'GitLab', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function extractGitLabProjectId(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/gitlab\.com\/(.+?)\/-\/issues/)
  return match?.[1] ?? null
}

const CLICKUP_API = 'https://api.clickup.com/api/v2'

async function closeClickUpTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${CLICKUP_API}/task/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'closed' }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'ClickUp', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

const ASANA_API = 'https://app.asana.com/api/1.0'

async function completeAsanaTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${ASANA_API}/tasks/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { completed: true } }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Asana', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

async function archiveShortcutStory(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${SHORTCUT_API}/stories/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      'Shortcut-Token': ctx.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Shortcut', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}

async function closeAzureDevOpsWorkItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const orgName = ctx.integrationConfig.organizationName as string
  if (!orgName) return { success: false, error: 'Missing Azure DevOps organizationName' }

  const encoded = Buffer.from(`:${ctx.accessToken}`).toString('base64')
  const orgUrl =
    (ctx.integrationConfig.organizationUrl as string) || `https://dev.azure.com/${orgName}`

  const response = await fetch(`${orgUrl}/_apis/wit/workitems/${ctx.externalId}?api-version=7.1`, {
    method: 'PATCH',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json-patch+json',
      Accept: 'application/json',
    },
    body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: 'Closed' }]),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Azure DevOps', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

const TRELLO_API = 'https://api.trello.com/1'

async function archiveTrelloCard(ctx: ArchiveContext): Promise<ArchiveResult> {
  const apiKey = ctx.integrationConfig.apiKey as string
  if (!apiKey) return { success: false, error: 'Missing Trello API key' }

  const params = new URLSearchParams({
    closed: 'true',
    key: apiKey,
    token: ctx.accessToken,
  })

  const response = await fetch(`${TRELLO_API}/cards/${ctx.externalId}?${params}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Trello', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

async function archiveNotionPage(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${NOTION_API}/pages/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ archived: true }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Notion', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}

const MONDAY_API = 'https://api.monday.com/v2'

async function archiveMondayItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      Authorization: ctx.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation ArchiveItem($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
      variables: { itemId: ctx.externalId },
    }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Monday', 'archived')
  if (err) return err

  const json = (await response.json()) as {
    data?: { archive_item?: { id: string } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}
