# Create and publish a Stack

[Functional spec — Flow 1](../stack-spec.md#flow-1-create-and-publish-a-stack) defines the editor, validation, and publish behavior for Party Mode.

1. Start from **Create**, an existing draft, **Remix**, or **Answer with a stack**. Sign in before entering the editor.
2. **Title:** enter a title (60 characters) or skip for now.
3. **Description:** optionally add a description (160 characters).
4. **Build:** add numbered or bulleted picks and up to five sections. A section title can be up to 40 characters. A Stack has up to 15 picks total, including unsectioned picks. Each pick has a heading (80), optional subheading (100), up to three tags (20 characters each), and an optional link stored separately. Reordering moves the entire pick with its stable ID. The editor supports deleting picks or sections with Undo.
5. **Finalize:** arrange and preview, confirm the theme, choose one or two platform categories, and set visibility (Public by default). Place stacks require a city. Preview shows what visitors will see.
6. **Publish:** require a title, at least one pick, a title and at least one pick in every section, and valid fields and limits. The server enforces the same rules. On success show **Share**, **Start another stack** and **Done**. Publish creates one Stack and consumes its draft.

There are no standalone paragraphs or rich-text blocks. Typed or pasted line breaks become spaces. Counters help users fix over-limit text, and the editor preserves input while they correct it.

## Drafts and failures

- Autosave to an owner-only server draft about one second after changes, starting with the first character. Show **Saving…**, **Saved just now**, or **Not saved · Retry**. Refresh restores the last saved step and content.
- Closing an empty editor creates no draft. Closing with content retains the draft and opens Profile › Drafts.
- Failed publish keeps the draft and offers retry or continued editing. A repeated request must not publish a duplicate or report success before the server confirms it.
- See [Stack visibility](stack-visibility.md) for where the published Stack appears.
