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
      <div className="space-y-3">
        <div>
          <h4 className="font-medium text-foreground mb-1.5">Endpoint</h4>
          <code className="block rounded-md bg-muted px-3 py-2.5 text-xs font-mono break-all select-all">
            {endpointUrl}
          </code>
        </div>

        <p className="text-xs">
          Authenticate with an{' '}
          <Link to="/admin/settings/api-keys" className="text-primary hover:underline">
            API key
          </Link>{' '}
          (<InlineCode>Authorization: Bearer qb_...</InlineCode>) or via{' '}
          <span className="font-medium text-foreground">OAuth</span> (browser login flow, supported
          by Claude Code and Claude Desktop).
        </p>
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
              <div className="space-y-2">
                <p className="font-medium text-foreground text-xs">With OAuth (recommended)</p>
                <p className="text-xs">
                  Add to <InlineCode>.mcp.json</InlineCode> in your project root:
                </p>
                <CodeBlock>{claudeCodeOAuthConfig(endpointUrl)}</CodeBlock>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground text-xs">With API Key</p>
                <p className="text-xs">
                  Set <InlineCode>QUACKBACK_API_KEY</InlineCode> in your environment:
                </p>
                <CodeBlock>{claudeCodeConfig(endpointUrl)}</CodeBlock>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cursor">
            <div className="space-y-2">
              <p className="text-xs">
                Add to <InlineCode>.cursor/mcp.json</InlineCode>. Set{' '}
                <InlineCode>QUACKBACK_API_KEY</InlineCode> in your environment. OAuth is not
                supported.
              </p>
              <CodeBlock>{cursorConfig(endpointUrl)}</CodeBlock>
            </div>
          </TabsContent>

          <TabsContent value="vscode">
            <div className="space-y-2">
              <p className="text-xs">
                Add to <InlineCode>.vscode/mcp.json</InlineCode>. VS Code will prompt for the API
                key on first use. Note: uses <InlineCode>servers</InlineCode> not{' '}
                <InlineCode>mcpServers</InlineCode>. OAuth is not supported.
              </p>
              <CodeBlock>{vscodeConfig(endpointUrl)}</CodeBlock>
            </div>
          </TabsContent>

          <TabsContent value="windsurf">
            <div className="space-y-2">
              <p className="text-xs">
                Add to <InlineCode>~/.codeium/windsurf/mcp_config.json</InlineCode>. Set{' '}
                <InlineCode>QUACKBACK_API_KEY</InlineCode> in your environment. Note: uses{' '}
                <InlineCode>serverUrl</InlineCode> not <InlineCode>url</InlineCode>. OAuth is not
                supported.
              </p>
              <CodeBlock>{windsurfConfig(endpointUrl)}</CodeBlock>
            </div>
          </TabsContent>

          <TabsContent value="claude-desktop">
            <div className="space-y-4">
              <p className="text-xs">
                Requires <InlineCode>mcp-remote</InlineCode> as a bridge (Node.js must be
                installed). Add to <InlineCode>claude_desktop_config.json</InlineCode>:
              </p>
              <div className="space-y-2">
                <p className="font-medium text-foreground text-xs">With OAuth (recommended)</p>
                <CodeBlock>{claudeDesktopOAuthConfig(endpointUrl)}</CodeBlock>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground text-xs">With API Key</p>
                <CodeBlock>{claudeDesktopApiKeyConfig(endpointUrl)}</CodeBlock>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Available Tools */}
      <div>
        <h4 className="font-medium text-foreground mb-2">Available Tools</h4>
        <p className="text-xs mb-2">
          <InlineCode>search</InlineCode> <InlineCode>get_details</InlineCode>{' '}
          <InlineCode>triage_post</InlineCode> <InlineCode>vote_post</InlineCode>{' '}
          <InlineCode>add_comment</InlineCode> <InlineCode>update_comment</InlineCode>{' '}
          <InlineCode>delete_comment</InlineCode> <InlineCode>react_to_comment</InlineCode>{' '}
          <InlineCode>create_post</InlineCode> <InlineCode>merge_post</InlineCode>{' '}
          <InlineCode>unmerge_post</InlineCode> <InlineCode>manage_roadmap_post</InlineCode>{' '}
          <InlineCode>create_changelog</InlineCode> <InlineCode>update_changelog</InlineCode>{' '}
          <InlineCode>delete_changelog</InlineCode>
        </p>
      </div>
    </div>
  )
}
