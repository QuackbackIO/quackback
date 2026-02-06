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

function claudeDesktopConfig(endpointUrl: string) {
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
          <p>
            All MCP requests must include an API key via the{' '}
            <InlineCode>Authorization: Bearer qb_...</InlineCode> header.{' '}
            <Link to="/admin/settings/api-keys" className="text-primary hover:underline">
              Create an API key
            </Link>{' '}
            in the API Keys settings if you haven't already.
          </p>
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
            <div className="space-y-3">
              <p>
                Add to <InlineCode>.mcp.json</InlineCode> in your project root. Set the{' '}
                <InlineCode>QUACKBACK_API_KEY</InlineCode> environment variable to your API key.
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
                variables. Requires Cursor v0.48.0+.
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
                <InlineCode>mcpServers</InlineCode>) as the top-level key.
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
                <InlineCode>url</InlineCode>.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="claude-desktop">
            <div className="space-y-3">
              <p>
                Claude Desktop doesn't support custom HTTP headers natively. Use{' '}
                <InlineCode>mcp-remote</InlineCode> as a bridge. Add to{' '}
                <InlineCode>claude_desktop_config.json</InlineCode>:
              </p>
              <CodeBlock>{claudeDesktopConfig(endpointUrl)}</CodeBlock>
              <p className="text-xs">
                Replace <InlineCode>qb_YOUR_API_KEY</InlineCode> with your actual API key. Requires
                Node.js installed.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Tools & Resources */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="font-medium text-foreground mb-2">Tools</h4>
          <div className="space-y-2">
            <ToolItem name="search" description="Search across posts and changelogs" />
            <ToolItem name="get_details" description="Get full details for any entity by ID" />
            <ToolItem
              name="triage_post"
              description="Update status, tags, owner, or official response"
            />
            <ToolItem name="add_comment" description="Post a comment on a feedback post" />
            <ToolItem name="create_post" description="Submit new feedback" />
            <ToolItem name="create_changelog" description="Create a changelog entry" />
          </div>
        </div>

        <div>
          <h4 className="font-medium text-foreground mb-2">Resources</h4>
          <div className="space-y-2">
            <ResourceItem uri="quackback://boards" description="List all boards" />
            <ResourceItem uri="quackback://statuses" description="List all statuses" />
            <ResourceItem uri="quackback://tags" description="List all tags" />
            <ResourceItem uri="quackback://roadmaps" description="List all roadmaps" />
            <ResourceItem uri="quackback://members" description="List all team members" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolItem({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono mt-0.5">
        {name}
      </code>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  )
}

function ResourceItem({ uri, description }: { uri: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono mt-0.5">
        {uri}
      </code>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  )
}
