/**
 * Project-specific architectural rules that have no native oxlint equivalent.
 * Loaded via jsPlugins in .oxlintrc.json.
 */
const MENU_ITEMS = new Set([
  'DropdownMenuItem',
  'DropdownMenuCheckboxItem',
  'DropdownMenuRadioItem',
  'CommandItem',
  'SelectItem',
])

const SMALL_MENU_TEXT = /text-xs|text-\[(?:8|9|10|11|12)px\]/
const SUB_11PX_TEXT = /text-\[(?:8|9|10)px\]/

function classNameLiterals(openingElement, visit) {
  for (const attr of openingElement.attributes ?? []) {
    if (attr.type !== 'JSXAttribute') continue
    if (attr.name?.type !== 'JSXIdentifier' || attr.name.name !== 'className') continue
    walkLiterals(attr.value, visit)
  }
}

function walkLiterals(node, visit) {
  if (!node) return
  if (node.type === 'Literal' && typeof node.value === 'string') visit(node)
  else if (node.type === 'JSXExpressionContainer') walkLiterals(node.expression, visit)
  else if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      visit({ type: 'Literal', value: quasi.value.cooked ?? '', loc: quasi.loc, range: quasi.range })
    }
  }
}

const noSmallMenuText = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Menu items render at 13px via the primitive; do not override them smaller.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name?.type !== 'JSXIdentifier' || !MENU_ITEMS.has(node.name.name)) return
        classNameLiterals(node, (literal) => {
          if (SMALL_MENU_TEXT.test(literal.value)) {
            context.report({
              node: literal,
              message:
                'Menu items render at 13px via the primitive; remove the smaller text override (see MENU-FILTER-SIZING-STANDARD.md).',
            })
          }
        })
      },
    }
  },
}

const noSub11pxText = {
  meta: {
    type: 'problem',
    docs: { description: 'Production text must be at least 11px.' },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'className') return
        walkLiterals(node.value, (literal) => {
          if (SUB_11PX_TEXT.test(literal.value)) {
            context.report({
              node: literal,
              message: 'Production text must be at least 11px; use a design-system text variant.',
            })
          }
        })
      },
    }
  },
}

function isErrorCall(stmt) {
  if (stmt.type !== 'ExpressionStatement' || stmt.expression.type !== 'CallExpression') return false
  const callee = stmt.expression.callee
  return callee.type === 'MemberExpression' && !callee.computed && callee.property?.name === 'error'
}

const noServerFnLogRethrow = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Server-function failures are logged once by functionMiddleware; do not log-and-rethrow.',
    },
  },
  create(context) {
    return {
      CatchClause(node) {
        const stmts = node.body?.body ?? []
        for (let i = 0; i < stmts.length - 1; i++) {
          if (isErrorCall(stmts[i]) && stmts[i + 1].type === 'ThrowStatement') {
            context.report({
              node: stmts[i],
              message:
                'Server-function failures are logged once by the global functionMiddleware; drop the log.error and just rethrow. To attach context, call setLogContext({ ... }) instead.',
            })
          }
        }
      },
    }
  },
}

const noWithErrorLog = {
  meta: {
    type: 'problem',
    docs: { description: 'withErrorLog was replaced by functionMiddleware.' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'withErrorLog') {
          context.report({
            node,
            message:
              'withErrorLog was replaced by the global functionMiddleware in src/start.ts. Handlers should throw and let it log.',
          })
        }
      },
    }
  },
}

export default {
  meta: { name: 'quackback' },
  rules: {
    'no-small-menu-text': noSmallMenuText,
    'no-sub-11px-text': noSub11pxText,
    'no-server-fn-log-rethrow': noServerFnLogRethrow,
    'no-with-error-log': noWithErrorLog,
  },
}
