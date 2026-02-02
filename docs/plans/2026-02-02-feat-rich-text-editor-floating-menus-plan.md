# Rich Text Editor: Linear-Style Floating Menus

## Overview

Enhance the existing Tiptap-based rich text editor with Linear-inspired bubble menu and slash command features to provide a more comprehensive editing experience.

## Current State Analysis

### What We Have

**Bubble Menu (on text selection):**

- Bold (Cmd+B)
- Italic (Cmd+I)
- Link insertion with URL popup

**Slash Commands (type `/`):**

- Text (paragraph)
- Heading 1, 2, 3 (when enabled)
- Bullet List
- Numbered List
- Code Block (when enabled)
- Image upload (when enabled)

**Fixed Toolbar:**

- All formatting buttons duplicated in top/bottom toolbar
- Undo/Redo

### What Linear Has (That We're Missing)

#### Bubble Menu Features

| Feature                | Linear | Quackback | Priority |
| ---------------------- | ------ | --------- | -------- |
| Bold                   | ✅     | ✅        | -        |
| Italic                 | ✅     | ✅        | -        |
| Link                   | ✅     | ✅        | -        |
| **Strikethrough**      | ✅     | ❌        | High     |
| **Underline**          | ✅     | ❌        | Medium   |
| **Inline Code**        | ✅     | ❌        | High     |
| **Heading conversion** | ✅     | ❌        | Medium   |
| **List type dropdown** | ✅     | ❌        | Low      |

#### Slash Command Features

| Feature                 | Linear | Quackback | Priority |
| ----------------------- | ------ | --------- | -------- |
| Headings                | ✅     | ✅        | -        |
| Bullet List             | ✅     | ✅        | -        |
| Numbered List           | ✅     | ✅        | -        |
| Code Block              | ✅     | ✅        | -        |
| Image                   | ✅     | ✅        | -        |
| **Checklist/Task List** | ✅     | ❌        | High     |
| **Blockquote**          | ✅     | ❌        | High     |
| **Horizontal Divider**  | ✅     | ❌        | Medium   |
| **Table**               | ✅     | ❌        | Medium   |
| **Collapsible Section** | ✅     | ❌        | Low      |
| **Date Picker**         | ✅     | ❌        | Low      |
| **File Attachment**     | ✅     | ❌        | Low      |
| **Mermaid Diagrams**    | ✅     | ❌        | Low      |

#### Markdown Shortcuts (Auto-conversion)

| Shortcut              | Linear | Quackback           | Priority |
| --------------------- | ------ | ------------------- | -------- |
| `**bold**`            | ✅     | ✅ (via StarterKit) | -        |
| `_italic_`            | ✅     | ✅ (via StarterKit) | -        |
| `# Heading`           | ✅     | ✅ (via StarterKit) | -        |
| `- List`              | ✅     | ✅ (via StarterKit) | -        |
| **`~strikethrough~`** | ✅     | ❌                  | High     |
| **`> Blockquote`**    | ✅     | ❌                  | High     |
| **`[] Checklist`**    | ✅     | ❌                  | High     |
| **`---` Divider**     | ✅     | ❌                  | Medium   |
| **`>>> Collapsible`** | ✅     | ❌                  | Low      |

#### Other Features

| Feature                                | Linear | Quackback | Priority        |
| -------------------------------------- | ------ | --------- | --------------- |
| **@ Mentions**                         | ✅     | ❌        | Medium (future) |
| **Collaborative editing**              | ✅     | ❌        | Out of scope    |
| **Auto-embeds (YouTube, Figma, Loom)** | ✅     | ❌        | Medium          |
| **Emoji picker**                       | ✅     | ❌        | Low             |

---

## Implementation Plan

### Phase 1: Enhanced Bubble Menu (High Priority)

Add missing inline formatting options to the bubble menu.

#### 1.1 Add Strikethrough Support

```typescript
// Already in StarterKit, just need to expose in bubble menu
<ToolbarButton
  icon={<Strikethrough className="size-4" />}
  onClick={() => editor.chain().focus().toggleStrike().run()}
  isActive={editor.isActive('strike')}
  title="Strikethrough (Cmd+Shift+S)"
/>
```

#### 1.2 Add Inline Code Support

```typescript
<ToolbarButton
  icon={<Code className="size-4" />}
  onClick={() => editor.chain().focus().toggleCode().run()}
  isActive={editor.isActive('code')}
  title="Inline Code (Cmd+E)"
/>
```

#### 1.3 Redesigned Bubble Menu Layout

```
┌─────────────────────────────────────────────────────┐
│  B   I   S   U   </>  │  🔗  │  H1 ▾  │  • ▾  │
│ Bold Ita Str Und Code │ Link │ Heading│ List  │
└─────────────────────────────────────────────────────┘
```

**Files to modify:**

- `apps/web/src/components/ui/rich-text-editor.tsx`
  - Update `BubbleMenuContent` component (lines 798-819)
  - Add new toolbar buttons for strikethrough, underline, inline code
  - Add heading dropdown (convert selection to H1/H2/H3)

**New dependencies:** None (strikethrough, underline, code are in StarterKit)

---

### Phase 2: Enhanced Slash Commands (High Priority)

Add missing block-level commands to the slash menu.

#### 2.1 Add Checklist/Task List

```typescript
// Requires: @tiptap/extension-task-list, @tiptap/extension-task-item
{
  title: 'Checklist',
  description: 'Task list with checkboxes',
  icon: <CheckSquare className="size-4" />,
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleTaskList().run()
  },
  aliases: ['todo', 'task', '[]'],
  group: 'lists',
}
```

#### 2.2 Add Blockquote

```typescript
// Enable in StarterKit config (currently disabled)
{
  title: 'Quote',
  description: 'Blockquote for citations',
  icon: <Quote className="size-4" />,
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  aliases: ['blockquote', '>'],
  group: 'text',
}
```

#### 2.3 Add Horizontal Divider

```typescript
// Enable in StarterKit config (currently disabled)
{
  title: 'Divider',
  description: 'Horizontal line separator',
  icon: <Minus className="size-4" />,
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  },
  aliases: ['hr', 'divider', '---'],
  group: 'advanced',
}
```

#### 2.4 Add Table Support

```typescript
// Requires: @tiptap/extension-table, @tiptap/extension-table-row,
//           @tiptap/extension-table-cell, @tiptap/extension-table-header
{
  title: 'Table',
  description: 'Insert a table',
  icon: <Table className="size-4" />,
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range)
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  },
  aliases: ['table', '|--'],
  group: 'advanced',
}
```

**Files to modify:**

- `apps/web/src/components/ui/rich-text-editor.tsx`
  - Update `getSlashMenuItems()` function (lines 79-201)
  - Update StarterKit config to enable blockquote, horizontalRule
  - Add new Tiptap extensions

**New dependencies:**

```bash
bun add @tiptap/extension-task-list @tiptap/extension-task-item
bun add @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header
```

---

### Phase 3: Markdown Input Rules (High Priority)

Enable automatic markdown conversion as users type.

#### 3.1 Enable Missing Input Rules

```typescript
// Update StarterKit configuration
StarterKit.configure({
  // Enable these (currently disabled)
  blockquote: true, // > for blockquote
  horizontalRule: true, // --- for divider
  strike: true, // ~~text~~ for strikethrough
})
```

#### 3.2 Add Custom Input Rules for Checklist

```typescript
// TaskList extension handles [] input rule automatically
```

**Files to modify:**

- `apps/web/src/components/ui/rich-text-editor.tsx`
  - Update StarterKit.configure() (lines 485-493)

---

### Phase 4: Feature Flags Update

Update the `EditorFeatures` interface to support new capabilities.

```typescript
export interface EditorFeatures {
  // Existing
  headings?: boolean
  images?: boolean
  codeBlocks?: boolean
  bubbleMenu?: boolean
  slashMenu?: boolean

  // New
  taskLists?: boolean // Enable checklist/task lists
  blockquotes?: boolean // Enable blockquotes
  tables?: boolean // Enable table insertion
  dividers?: boolean // Enable horizontal rules
  embeds?: boolean // Enable YouTube/Figma embeds (future)
}
```

---

### Phase 5: Table UI (Medium Priority)

Tables require additional UI for:

- Adding/removing rows and columns
- Resizing columns
- Header row toggle

This can be implemented with a floating table toolbar that appears when the cursor is in a table.

---

### Phase 6: Auto-Embeds (Medium Priority)

Automatically convert pasted URLs into embeds:

- YouTube videos → embedded player
- Figma links → embedded frame
- Loom videos → embedded player

**Implementation approach:**

- Use `@tiptap/extension-link` with custom paste handler
- Detect URL patterns and convert to custom embed nodes

---

## Summary: Prioritized Task List

### High Priority (Phase 1-3)

1. [ ] Add strikethrough to bubble menu
2. [ ] Add inline code to bubble menu
3. [ ] Add blockquote to slash commands + enable input rule
4. [ ] Add checklist/task list to slash commands
5. [ ] Add horizontal divider to slash commands + enable input rule
6. [ ] Update feature flags interface

### Medium Priority (Phase 4-5)

7. [ ] Add table support with slash command
8. [ ] Add table floating toolbar for row/column management
9. [ ] Add heading dropdown to bubble menu
10. [ ] Add auto-embeds for YouTube/Figma/Loom

### Low Priority (Future)

11. [ ] Add collapsible sections
12. [ ] Add date picker
13. [ ] Add file attachments
14. [ ] Add @ mentions
15. [ ] Add emoji picker

---

## Technical Notes

### Tiptap Extensions Needed

```bash
# High priority
bun add @tiptap/extension-task-list @tiptap/extension-task-item

# Medium priority
bun add @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header

# Low priority (future)
bun add @tiptap/extension-youtube
```

### Keyboard Shortcuts to Implement

| Action        | Shortcut    | Status |
| ------------- | ----------- | ------ |
| Bold          | Cmd+B       | ✅     |
| Italic        | Cmd+I       | ✅     |
| Strikethrough | Cmd+Shift+S | To add |
| Underline     | Cmd+U       | To add |
| Inline Code   | Cmd+E       | To add |
| Link          | Cmd+K       | To add |
| Undo          | Cmd+Z       | ✅     |
| Redo          | Cmd+Shift+Z | ✅     |

### SSR Considerations

The `RichTextContent` component (lines 1163-1185) will need updates to render:

- Task lists with checkboxes
- Tables
- Blockquotes
- Horizontal rules

---

## Sources

- [Linear Editor Documentation](https://linear.app/docs/editor)
- [Linear Editor Improvements Changelog (April 2024)](https://linear.app/changelog/2024-04-24-editor-improvements)
- [Tiptap Documentation](https://tiptap.dev/docs)
