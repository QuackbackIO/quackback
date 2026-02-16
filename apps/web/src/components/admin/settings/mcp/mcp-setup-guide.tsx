import { Link } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface McpSetupGuideProps {
  endpointUrl: string
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="rounded-md bg-muted px-3 py-2.5 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
      {children}
    </pre>
  )
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{children}</code>
}

function claudeCodeConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          type: 'http',
          url: endpointUrl,
          headers: {
            Authorization: 'Bearer ${QUACKBACK_API_KEY}',
          },
        },
      },
    },
    null,
    2
  )
}

function cursorConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          url: endpointUrl,
          headers: {
            Authorization: 'Bearer ${env:QUACKBACK_API_KEY}',
          },
        },
      },
    },
    null,
    2
  )
}

function vscodeConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      inputs: [
        {
          type: 'promptString',
          id: 'quackback-api-key',
          description: 'Quackback API Key (qb_...)',
          password: true,
        },
      ],
      servers: {
        quackback: {
          type: 'http',
          url: endpointUrl,
          headers: {
            Authorization: 'Bearer ${input:quackback-api-key}',
          },
        },
      },
    },
    null,
    2
  )
}

function windsurfConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          serverUrl: endpointUrl,
          headers: {
            Authorization: 'Bearer ${env:QUACKBACK_API_KEY}',
          },
        },
      },
    },
    null,
    2
  )
}

function claudeDesktopApiKeyConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          command: 'npx',
          args: [
            'mcp-remote@latest',
            '--http',
            endpointUrl,
            '--header',
            'Authorization: Bearer qb_YOUR_API_KEY',
          ],
        },
      },
    },
    null,
    2
  )
}

function claudeCodeOAuthConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          type: 'http',
          url: endpointUrl,
        },
      },
    },
    null,
    2
  )
}

function claudeDesktopOAuthConfig(endpointUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        quackback: {
          command: 'npx',
          args: ['mcp-remote@latest', '--http', endpointUrl],
        },
      },
    },
    null,
    2
  )
}

export function McpSetupGuide({ endpointUrl }: McpSetupGuideProps) {
  return (
    <div className="space-y-6 text-sm text-muted-foreground">
      {/* Endpoint & Auth */}
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-foreground mb-1.5">Endpoint URL</h4>
          <code className="block rounded-md bg-muted px-3 py-2.5 text-xs font-mono break-all select-all">
            {endpointUrl}
          </code>
        </div>

        <div>
          <h4 className="font-medium text-foreground mb-1.5">Authentication</h4>
          <div className="space-y-2">
            <p>Two authentication methods are supported:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>
                <span className="font-medium text-foreground">API Key</span> - for CI/automation.
                Requires a <InlineCode>qb_</InlineCode> token in the{' '}
                <InlineCode>Authorization</InlineCode> header.{' '}
                <Link to="/admin/settings/api-keys" className="text-primary hover:underline">
                  Create an API key
                </Link>{' '}
                if you haven't already.
              </li>
              <li>
                <span className="font-medium text-foreground">OAuth</span> - for interactive use.
                The client opens a browser-based login flow, no API key needed. Supported by Claude
                Code and Claude Desktop.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Client Setup Tabs */}
      <div>
        <h4 className="font-medium text-foreground mb-3">Client Setup</h4>
        <Tabs defaultValue="claude-code">
          <TabsList className="border-b border-border w-full justify-start">
            <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
            <TabsTrigger value="cursor">Cursor</TabsTrigger>
            <TabsTrigger value="vscode">VS Code</TabsTrigger>
            <TabsTrigger value="windsurf">Windsurf</TabsTrigger>
            <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
          </TabsList>

          <TabsContent value="claude-code">
            <div className="space-y-4">
              <div className="space-y-3">
                <p className="font-medium text-foreground text-xs">With OAuth (recommended)</p>
                <p>
                  Add to <InlineCode>.mcp.json</InlineCode> in your project root. Claude Code will
                  open a browser login flow on first use.
                </p>
                <CodeBlock>{claudeCodeOAuthConfig(endpointUrl)}</CodeBlock>
              </div>
              <div className="space-y-3">
                <p className="font-medium text-foreground text-xs">With API Key</p>
                <p>
                  Set the <InlineCode>QUACKBACK_API_KEY</InlineCode> environment variable to your
                  API key.
                </p>
                <CodeBlock>{claudeCodeConfig(endpointUrl)}</CodeBlock>
                <p className="text-xs">
                  Or use the CLI:{' '}
                  <InlineCode>
                    claude mcp add --transport http quackback {endpointUrl} --header
                    &quot;Authorization: Bearer $QUACKBACK_API_KEY&quot;
                  </InlineCode>
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cursor">
            <div className="space-y-3">
              <p>
                Add to <InlineCode>.cursor/mcp.json</InlineCode> in your project root. Set the{' '}
                <InlineCode>QUACKBACK_API_KEY</InlineCode> environment variable to your API key.
              </p>
              <CodeBlock>{cursorConfig(endpointUrl)}</CodeBlock>
              <p className="text-xs">
                Cursor uses <InlineCode>{'${env:VAR}'}</InlineCode> syntax for environment
                variables. Requires Cursor v0.48.0+. OAuth is not supported by Cursor - use an API
                key.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="vscode">
            <div className="space-y-3">
              <p>
                Add to <InlineCode>.vscode/mcp.json</InlineCode> in your project root. VS Code will
                prompt you for the API key on first use and store it securely.
              </p>
              <CodeBlock>{vscodeConfig(endpointUrl)}</CodeBlock>
              <p className="text-xs">
                Note: VS Code uses <InlineCode>servers</InlineCode> (not{' '}
                <InlineCode>mcpServers</InlineCode>) as the top-level key. OAuth is not supported by
                VS Code - use an API key.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="windsurf">
            <div className="space-y-3">
              <p>
                Add to <InlineCode>~/.codeium/windsurf/mcp_config.json</InlineCode>. Set the{' '}
                <InlineCode>QUACKBACK_API_KEY</InlineCode> environment variable to your API key.
              </p>
              <CodeBlock>{windsurfConfig(endpointUrl)}</CodeBlock>
              <p className="text-xs">
                Note: Windsurf uses <InlineCode>serverUrl</InlineCode> instead of{' '}
                <InlineCode>url</InlineCode>. OAuth is not supported by Windsurf - use an API key.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="claude-desktop">
            <div className="space-y-4">
              <p>
                Claude Desktop requires <InlineCode>mcp-remote</InlineCode> as a bridge. Add to{' '}
                <InlineCode>claude_desktop_config.json</InlineCode>:
              </p>
              <div className="space-y-3">
                <p className="font-medium text-foreground text-xs">With OAuth (recommended)</p>
                <CodeBlock>{claudeDesktopOAuthConfig(endpointUrl)}</CodeBlock>
                <p className="text-xs">
                  A browser login flow will open on first use. Requires Node.js installed.
                </p>
              </div>
              <div className="space-y-3">
                <p className="font-medium text-foreground text-xs">With API Key</p>
                <CodeBlock>{claudeDesktopApiKeyConfig(endpointUrl)}</CodeBlock>
                <p className="text-xs">
                  Replace <InlineCode>qb_YOUR_API_KEY</InlineCode> with your actual API key.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Tools & Resources */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="font-medium text-foreground mb-2">Tools</h4>
          <div className="space-y-2">
            <DefinitionItem label="search" description="Search across posts and changelogs" />
            <DefinitionItem
              label="get_details"
              description="Get full details for any entity by ID"
            />
            <DefinitionItem
              label="triage_post"
              description="Update status, tags, owner, or official response"
            />
            <DefinitionItem label="add_comment" description="Post a comment on a feedback post" />
            <DefinitionItem label="create_post" description="Submit new feedback" />
            <DefinitionItem label="create_changelog" description="Create a changelog entry" />
          </div>
        </div>

        <div>
          <h4 className="font-medium text-foreground mb-2">Resources</h4>
          <div className="space-y-2">
            <DefinitionItem label="quackback://boards" description="List all boards" />
            <DefinitionItem label="quackback://statuses" description="List all statuses" />
            <DefinitionItem label="quackback://tags" description="List all tags" />
            <DefinitionItem label="quackback://roadmaps" description="List all roadmaps" />
            <DefinitionItem label="quackback://members" description="List all team members" />
          </div>
        </div>
      </div>
    </div>
  )
}

function DefinitionItem({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono mt-0.5">
        {label}
      </code>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  )
}
