import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// Files that ARE the re-export layer or standalone scripts — they must import @quackback/db directly
const dbReexportFiles = [
  '**/src/lib/server/db.ts',
  // The tenancy module is the layer that BUILDS `Database` handles — it is what
  // `db.ts` resolves through under pooled tenancy, so it necessarily imports the
  // client factory the rest of the app is kept away from.
  '**/src/lib/server/workspaces/pool-cache.ts',
  '**/src/lib/server/workspaces/workspace-context.ts',
  // The fleet migrator operates ON databases rather than through one. It builds
  // its own direct, session-mode connection per workspace (the pooled handle
  // `db.ts` resolves cannot run `pg_advisory_lock` or `CREATE INDEX
  // CONCURRENTLY`), reads the bundled migration journal, and runs the executor —
  // none of which is expressible through the re-export layer. Named file by file
  // rather than by directory so a fourth module has to justify itself.
  '**/src/lib/server/fleet/migrator.ts',
  '**/src/lib/server/fleet/schema-state.ts',
  '**/src/lib/server/fleet/schema-floor.ts',
  // Its tests assert against the same layer, and a test forced through the
  // re-export would be asserting about a different object than the one shipped.
  '**/src/lib/server/fleet/__tests__/**',
  '**/src/lib/server/events/__tests__/changelog-segment-targets.db.test.ts',
  '**/src/lib/server/jobs/__tests__/harness.ts',
  '**/src/lib/server/kv/__tests__/harness.ts',
  '**/src/lib/shared/db-types.ts',
  '**/scripts/**',
]

// `no-restricted-imports` fragments, shared because flat config REPLACES a
// rule's options rather than merging them. A later block that configures the
// rule with only its own concern silently switches off every earlier one for
// the files it matches, so each block below restates everything that should
// apply to its file set.
const noDirectDbImport = {
  group: ['@quackback/db', '@quackback/db/*'],
  message: "Import from '@/lib/server/db' (server) or '@/lib/shared/db-types' (client) instead.",
}
const noComponentsFromLib = {
  group: ['@/components/*', '@/components/**'],
  message: 'lib/ must not import from components/.',
}
// The Redis queue and kv clients left the dependency tree when both moved to
// Postgres. The manifest already fails any import at install/typecheck; this
// keeps the packages from being quietly re-added.
const redisMovedToPostgresMessage =
  'The background queue and kv store live in Postgres now (see src/lib/server/jobs/ and src/lib/server/kv/); do not reintroduce bullmq or ioredis.'
const noRedisQueueImport = {
  group: ['bullmq', 'bullmq/*', 'ioredis', 'ioredis/*'],
  message: redisMovedToPostgresMessage,
}
// `require()` form of the same ban, for the no-restricted-syntax blocks below.
const noRedisQueueRequire = {
  selector: "CallExpression[callee.name='require'] > Literal[value=/^(bullmq|ioredis)(\\/|$)/]",
  message: redisMovedToPostgresMessage,
}

// Existing domain hotspots are an explicit, shrink-only debt baseline. New
// domain files fail at 400 lines; removing an entry promotes that file to the
// enforced limit without changing the rule for the rest of the tree.
const domainMaxLinesBaseline = [
  '**/domains/analytics/copilot-usage.ts',
  '**/domains/api/schemas/roadmaps.ts',
  '**/domains/api/schemas/status.ts',
  '**/domains/assistant/assistant.runtime.ts',
  '**/domains/assistant/assistant.tools.ts',
  '**/domains/assistant/assistant.toolspec.ts',
  '**/domains/assistant/conversation-summary.service.ts',
  '**/domains/boards/board.service.ts',
  '**/domains/changelog/changelog.service.ts',
  '**/domains/comments/comment.service.ts',
  '**/domains/conversation/conversation.email-inbound.service.ts',
  '**/domains/conversation/conversation.email-inbound.ts',
  '**/domains/conversation/conversation.notify.ts',
  '**/domains/conversation/conversation.query.ts',
  '**/domains/conversation/conversation.service.ts',
  '**/domains/conversation/conversation-tag.service.ts',
  '**/domains/conversation/conversation-translation.service.ts',
  '**/domains/feedback/pipeline/interpretation.service.ts',
  '**/domains/feedback/pipeline/suggestion.service.ts',
  '**/domains/help-center/help-center-search.service.ts',
  '**/domains/help-center/help-center.article.service.ts',
  '**/domains/help-center/help-center.category.service.ts',
  '**/domains/inbox/inbox.query.ts',
  '**/domains/merge-suggestions/merge-suggestion.service.ts',
  '**/domains/posts/post.merge.ts',
  '**/domains/posts/post.public.detail.ts',
  '**/domains/posts/post.service.ts',
  '**/domains/principals/principal-repoint.ts',
  '**/domains/segments/segment.evaluation.ts',
  '**/domains/segments/segment.service.ts',
  '**/domains/settings/identity-providers.service.ts',
  '**/domains/settings/settings.service.ts',
  '**/domains/settings/settings.types.ts',
  '**/domains/sla/sla.service.ts',
  '**/domains/status/status.service.ts',
  '**/domains/subscriptions/subscription.service.ts',
  '**/domains/tickets/ticket.service.ts',
  '**/domains/users/user.service.ts',
  '**/domains/workflows/action.executor.ts',
  '**/domains/workflows/event-trigger.ts',
  '**/domains/workflows/graph.ts',
  '**/domains/workflows/workflow-sweep.ts',
  '**/domains/workflows/workflow.engine.ts',
  '**/domains/workflows/workflow.schemas.ts',
]

// Existing client-boundary violations stay explicit while all new component
// paths are protected by the rule below.
const componentServerImportBaseline = [
  '**/components/admin/automation/workflow-graph.ts',
  '**/components/admin/settings/api-keys/api-keys-settings.tsx',
  '**/components/admin/settings/api-keys/create-api-key-dialog.tsx',
  '**/components/admin/settings/experimental-settings.tsx',
  '**/components/admin/settings/integrations/**',
  '**/components/auth/portal-auth-form-inline.tsx',
  '**/components/auth/use-auto-open-auth.ts',
  '**/components/public/comment-content.tsx',
  '**/components/public/comment-thread.tsx',
]

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/.next/**',
      '**/.output/**',
      '**/dist/**',
      '**/build/**',
      '**/.agents/**',
      '**/.claude/**',
      '**/scratchpad/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/next-env.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: dbReexportFiles,
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', { patterns: [noDirectDbImport, noRedisQueueImport] }],
      // Sizing standard (MENU-FILTER-SIZING-STANDARD.md): menu items render at
      // 13px via the shadcn primitives, so a smaller text override on one of
      // them is drift. Catches text-xs / text-[<=12px] on the item components.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXOpeningElement[name.name=/^(DropdownMenuItem|DropdownMenuCheckboxItem|DropdownMenuRadioItem|CommandItem|SelectItem)$/] Literal[value=/text-xs|text-\\[(?:8|9|10|11|12)px\\]/]',
          message:
            'Menu items render at 13px via the primitive; remove the smaller text override (see MENU-FILTER-SIZING-STANDARD.md).',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/text-\\[(?:8|9|10)px\\]/]",
          message: 'Production text must be at least 11px; use a design-system text variant.',
        },
        noRedisQueueRequire,
      ],
    },
  },
  // The exempted files still need the base TS rules, just without the db import
  // restriction — the Redis-client ban has no exemptions.
  {
    files: dbReexportFiles,
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', { patterns: [noRedisQueueImport] }],
      'no-restricted-syntax': ['error', noRedisQueueRequire],
    },
  },
  // lib/ must not import from components/
  {
    files: ['**/src/lib/**/*.{ts,tsx}'],
    ignores: dbReexportFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [noDirectDbImport, noComponentsFromLib, noRedisQueueImport] },
      ],
    },
  },
  // Server-function failures are logged once, globally, by the
  // `functionMiddleware` in src/start.ts (see lib/server/middleware/
  // server-fn-log.ts). Re-adding a per-handler log-and-rethrow tail produces a
  // second line for the same failure, and — because it has to be remembered at
  // every call site — reliably ends up covering only part of the surface. That
  // is what these rules exist to prevent: the previous hand-rolled helper
  // reached just 46% of server functions before it was replaced.
  //
  // A catch that RECOVERS (returns a fallback, swallows deliberately) is still
  // fine and still wants its own log; only log-then-rethrow is banned.
  {
    files: ['**/src/lib/server/functions/**/*.ts'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CatchClause > BlockStatement > ExpressionStatement[expression.callee.property.name='error'] + ThrowStatement",
          message:
            'Server-function failures are logged once by the global functionMiddleware; drop the log.error and just rethrow. To attach context, call setLogContext({ ... }) instead.',
        },
        {
          selector: "CallExpression[callee.name='withErrorLog']",
          message:
            'withErrorLog was replaced by the global functionMiddleware in src/start.ts. Handlers should throw and let it log.',
        },
        noRedisQueueRequire,
      ],
    },
  },
  // Page routes are client-bundled (via routeTree.gen), so server logic must
  // cross through createServerFn bridges in lib/server/functions. Anything
  // else drags server modules (db/cache/settings) into the client graph, which
  // import-protection rejects at request time — this rule fails it at lint
  // time instead. Pure helpers belong in lib/shared.
  {
    files: ['**/src/routes/**/*.tsx'],
    ignores: ['**/src/routes/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/server/*',
                '@/lib/server/**',
                '!@/lib/server/functions',
                '!@/lib/server/functions/**',
              ],
              allowTypeImports: true,
              message:
                "Route files are client-bundled. Call server logic through a createServerFn in '@/lib/server/functions/*', or move pure helpers to '@/lib/shared/*'.",
            },
          ],
        },
      ],
    },
  },
  // Components are client-capable too; server values must cross a server-fn
  // boundary. Type-only domain imports are erased and remain safe.
  {
    files: ['**/src/components/**/*.{ts,tsx}'],
    ignores: ['**/src/components/**/__tests__/**', ...componentServerImportBaseline],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/server/*',
                '@/lib/server/**',
                '!@/lib/server/functions',
                '!@/lib/server/functions/**',
              ],
              allowTypeImports: true,
              message:
                "Components are client-capable. Call server logic through '@/lib/server/functions/*', or move pure helpers to '@/lib/shared/*'.",
            },
          ],
        },
      ],
    },
  },
  // Existing service-file debt remains visible as warnings.
  {
    files: domainMaxLinesBaseline,
    rules: {
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  // New domain files cannot silently join the hotspot baseline.
  {
    files: ['**/server/domains/**/*.{ts,tsx}'],
    ignores: ['**/server/domains/**/__tests__/**', ...domainMaxLinesBaseline],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  // Test files grow to 2-3x source size due to shared mock setup; allow a higher limit
  {
    files: ['**/server/domains/**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/client/hooks/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  }
)
