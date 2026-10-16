# Link text follows its link, tidy reference tree

Source: planning.md, 2026-10-16

## Goal

When a link or chip has no text of its own, its visible text should follow what it points to. Today, pasting a URL over a link that shows its own URL only changes where it points, and the old URL text stays. Re-embedding a web link in the Insert link dialog keeps the old text too. Separately, long names in the Insert link dialog's "In app" tree can stretch the dialog and make it scroll sideways. They should be capped and cut off cleanly.

## Context

- The app is Tauri v2 around a Next.js static export. Verification and testing follow `CLAUDE.md`.
- **Editor extensions.** All three Tiptap 3.29.2 editors build their extensions from `createEditorExtensions()` in `lib/tiptap/extensions.ts`, so a paste fix there or in `lib/tiptap/reference.ts` covers all three. The three editors are:
  - `components/editor/RichTextEditor.tsx`
  - `components/editor/StickyNoteEditor.tsx`
  - `components/canvas/RichTextShape.tsx`
- **Link** comes from StarterKit with `openOnClick: false`. Otherwise Tiptap's defaults apply: `linkOnPaste: true` and `autolink: true`, and the mark is inclusive.
  - Pasting a URL at an empty cursor inserts the URL text, and Link's paste rule marks it.
  - The text is the URL as pasted, which linkify normalises for the href. For example, the text `example.com` gets the href `http://example.com`.
- **Paste handlers, in priority order:**
  1. `ReferencePaste` (`lib/tiptap/reference.ts`, priority 1001) handles `skylines://` tokens through `insertReference`.
  2. Link's own `pasteHandler` (priority 1000) handles a single URL pasted over a non-empty selection. It runs `setMark(link, { href })`, so the selected text is never replaced. This is the bug.
  3. A URL pasted over a selected chip (`NodeSelection`) puts a link mark on the chip node itself. The chip stays, and the new URL is hidden.
- **Chips** are the inline atom node `reference`.
  - `label` is fixed text chosen at insert time, and `null` means the chip shows its live title.
  - `lastTitle` is a cache.
  - `removeReference(pos)` in `reference.ts` shows how to replace a chip while keeping its marks: `tr.replaceWith(..., schema.text(text, node.marks))`.
- **Insert link dialog** (`components/editor/InsertLinkDialog.tsx`):
  - `applyLink` / `applyUrl` / `handleSubmitUrl`: inside a link, or with a text selection, the dialog runs `extendMarkRange("link").setLink({ href })`, which changes only the href.
  - With an empty selection, it inserts the href as linked text, then runs `unsetMark("link")` so that typing afterwards doesn't extend the link.
  - Replacing a chip with a URL uses `insertContentAt(range, linked text)`. That drops the surrounding marks (bold, colour, size, highlight).
  - `currentUrl` comes from `editor.getAttributes("link").href` (`components/ribbon/formatActions.ts`). It is passed by `RichTextEditor.tsx` and `RichTextShape.tsx`, but `StickyNoteEditor.tsx` passes `currentUrl={null}`. So in sticky notes, the URL field is blank on a link and the Web link panel's "Remove link" never shows.
- **Reference tree.** It is in `components/editor/ReferencePicker.tsx`:
  - `TreeNode.label` is the name, and `renderNode` draws each row: a label button with `min-w-0 flex-1 truncate`, then a faded kind word.
  - Plain search words match `label`. `has:` matches `text`, which holds the full text, but only for text boxes and sticky notes.
  - Text box labels come from `extractPlainText(doc, 60)`. Untitled sticky labels are their text `.slice(0, 60)`, with no "…".
  - Notebook, folder, note and page names have no limit.
- **Why the dialog scrolls sideways.** `DialogContent` (`components/ui/dialog.tsx`) is a CSS grid, and the "In app" panel and the list have no `min-w-0`. One long row therefore widens the grid column, so `truncate` never kicks in. The dialog's `overflow-y-auto` then scrolls sideways too.
- **Shortening helpers.**
  - `extractPlainText` in `lib/tiptap/extractText.ts` works on Tiptap JSON only.
  - `lib/references/resolve.ts` has a private `truncate(text, max)` that returns `slice(0, max).trimEnd() + "…"`.
  - Don't change `extractPlainText`'s defaults or `resolve.ts`'s `TITLE_LENGTH`. They feed chips, hover cards and saved `lastTitle`s.

## Decisions

- **"No original text"** means a chip with `label == null`, or a web link whose text equals its href. The comparison ignores a leading `http://` or `https://` and a trailing `/` on both sides, so the text `example.com` matches the href `http://example.com/`.
- **Pasting a URL over a selection** replaces the selection with the new URL as linked text, but only when the selection is exactly one of these:
  - a selected chip, labelled or not, as in the dialog's chip-to-URL case
  - a web link with no original text, the whole link or any part of it
  
  The new text keeps the replaced content's other marks (bold, colour, and so on). Selecting ordinary words, or a link with custom text, and pasting a URL still turns those words into a link (stock behaviour).
- **Pasting a `skylines://` token** over a selected web link with no original text gives an unlabelled chip. Today the old URL becomes the chip's fixed label. Over a link with custom text, that text still becomes the label (unchanged).
- **Re-embedding a web link in the dialog** (the cursor or selection is inside an existing link) always replaces the whole link's text with the new URL, even custom text (user's choice). Applying a URL to a text selection that isn't in a link still links those words, as now.
- Every replacement keeps the replaced text's other marks, adds the link mark, and is one undo step. It is followed by `unsetMark("link")`, so typing afterwards doesn't extend the link.
- Sticky notes pass `currentUrl` like the other editors, so re-embedding and Remove link work there too.
- **Tree names:**
  - Each row's displayed name is capped at 40 characters with "…", and the row's `title` attribute holds the full name.
  - Rows also never widen the dialog: they cut off at the dialog edge, so the dialog never scrolls sideways.
  - Plain search words still match the full name (as today for notebooks, folders, notes and pages). Text box and untitled sticky labels stay as they are now: 60 characters at most.

## Out of scope

- Changing how chips with a fixed label display, or how labels are chosen at insert time from ordinary selected text.
- A setting to turn off link-on-paste.
- Changing the cap on names in chips, hover cards or the "Currently: …" line.

## Tasks

### T1 Pasting over an auto-text link or chip replaces it

Status: done
Depends on: none
Tester: yes, a paste can be driven with `editor.view.pasteText(...)` in a text box and the resulting HTML read from the DOM

Fix the paste path in `lib/tiptap/reference.ts` (inside `ReferencePaste`, or a sibling paste plugin with priority above Link's 1000) for all three editors.

1. **A single URL over a chip or an auto-text link.** When the clipboard text/plain is a single URL and the selection is one of the cases under Decisions, replace the selection with the URL as linked text.
   - A selected chip is a `NodeSelection` on a `reference`.
   - An auto-text link is a text selection inside one web link whose text equals its href.
   - Use linkify's href, as Link does: `find` from `linkifyjs`, which Link already uses, or the same check Link's `pasteHandler` makes.
   - Build the replacement text with the replaced content's marks plus the new link mark, in one transaction, then `unsetMark("link")`.
   - Return `true`, so Link's `pasteHandler` doesn't also run.
2. **A `skylines://` token over an auto-text link.** `insertReference` gives an unlabelled chip, instead of using the old URL text as the label.
3. **Everything else is unchanged.** That covers pasting at an empty cursor, a URL over ordinary text or a custom-text link, and a token over ordinary text.
4. **Shared helpers.** Put the "is this link's text its own URL" check and the "replace range with linked text, keeping marks" step in exported helpers in `lib/tiptap/reference.ts` (or a new `lib/tiptap/link.ts`). T2 reuses them.

Files: `lib/tiptap/reference.ts` (possibly a new `lib/tiptap/link.ts`)

Acceptance:
- Pasting `https://b.example` over a selected link whose text is `https://a.example` leaves the text `https://b.example`, linked to `https://b.example`, in one undo step.
- Pasting a URL over a selected chip (labelled or not) replaces the chip with the URL as linked text. No chip keeps a link mark.
- Pasting a URL over a bold auto-text link leaves bold, linked new text.
- Pasting a URL over selected ordinary words, or over a link with custom text, still makes those words a link, with the text unchanged.
- Pasting a `skylines://` token over a selected auto-text link gives a chip with no label. Over a selected custom-text link, the chip's label is that text.
- Typing right after a replacement isn't linked.

Test steps:
1. Create a test note with a text box. Paste `https://a.example` into it: the link text is `https://a.example`.
2. Select that whole link and paste `https://b.example`: the text and href are both `https://b.example`. Press Cmd+Z: the text and href are `https://a.example` again.
3. Type "docs", select it and paste `https://c.example`: "docs" is now a link to `https://c.example`.
4. Insert a chip to the test note, select it (click it while editing) and paste `https://d.example`: the chip is gone, replaced by `https://d.example` linked text.
5. Paste `https://e.example`, select it, then paste the test note's `skylines://` reference: an unlabelled chip shows the note's live title.
6. Delete the test note.

### T2 Re-embedding a web link updates its text

Status: done
Depends on: T1
Tester: yes, the dialog's results are visible in the editor's DOM

In `components/editor/InsertLinkDialog.tsx`, when the dialog applies a URL with the cursor or selection inside an existing web link, the dialog replaces the whole link (its `extendMarkRange("link")` range) with the new URL as linked text. This happens even when the link has custom text (see Decisions). Use T1's helper so other marks are kept, the change is one undo step, and `unsetMark("link")` follows.

Also switch the chip-to-URL path from `insertContentAt` to the same helper, so a chip's marks carry over. Applying a URL to a text selection that isn't in a link stays as it is (`setLink` on the selection), and so does inserting at an empty cursor.

In `components/editor/StickyNoteEditor.tsx`, pass `currentUrl` the way the other two editors do (`editor.isActive("link") ? editor.getAttributes("link").href : null`, or via `formatActions.ts`), instead of `null`.

Files: `components/editor/InsertLinkDialog.tsx`, `components/editor/StickyNoteEditor.tsx`

Acceptance:
- With the cursor inside a link (with auto or custom text) and a new URL applied in the dialog, the whole link's text becomes the new URL, linked to it, in one undo step. Bold and colour on the old link carry over.
- Replacing a bold chip with a URL in the dialog gives bold, linked URL text.
- Selecting non-link words and applying a URL still links those words, with the text unchanged.
- In a sticky note, Cmd+K with the cursor in a link prefills the URL field and shows the Web link panel's "Remove link".

Test steps:
1. Create a test note with a text box. Paste `https://a.example`, put the cursor inside it, press Cmd+K and apply `https://b.example`: the text and href are both `https://b.example`. Press Cmd+Z: it's `https://a.example` again.
2. Make "read this" a link to `https://c.example`. Put the cursor inside it, press Cmd+K and apply `https://d.example`: the text is now `https://d.example`.
3. Type "plain words", select them, press Cmd+K and apply `https://e.example`: "plain words" is a link, with the text unchanged.
4. Create a sticky note and paste `https://f.example` into it. Put the cursor inside it and press Cmd+K: the URL field shows `https://f.example` and "Remove link" shows in the Web link panel. Apply `https://g.example`: the text becomes `https://g.example`.
5. Delete the test note and the sticky note.

### T3 Long names in the reference tree stay inside the dialog

Status: todo
Depends on: none
Tester: yes, row text, the title attribute and the dialog's scrollWidth vs clientWidth are measurable in the DOM

There are two parts.

1. **Character cap.** In `components/editor/ReferencePicker.tsx`'s `renderNode`, show each row's `label` capped at 40 characters with "…", and put the full `label` in the label button's `title`.
   - Cap only at render time, so search (`matches`) still uses the full `label`.
   - For the helper, export `resolve.ts`'s `truncate` or add a small plain-string one next to `extractPlainText`. Don't change existing limits elsewhere.
2. **Layout.** Stop wide rows from widening the dialog, so the label's `truncate` takes effect.
   - Add `min-w-0` to the "In app" panel in `InsertLinkDialog.tsx` and to the tree list in `ReferencePicker.tsx`. Use `grid-cols-[minmax(0,1fr)]` on that dialog's content if needed.
   - Add `overflow-x-hidden` to the list, so it scrolls only vertically.
   - Check the Web link panel and the "Currently: …" line too.

Files: `components/editor/ReferencePicker.tsx`, `components/editor/InsertLinkDialog.tsx`, possibly `lib/references/resolve.ts` or `lib/tiptap/extractText.ts`

Acceptance:
- No tree row shows more than 40 characters of name plus "…", and a capped row's `title` is the full name.
- With a 200-character note title in the tree, expanded, the dialog's `scrollWidth` equals its `clientWidth` (no sideways scroll), in the main window and in a sticky window.
- Searching for a word that appears only after the 40th character of a note title still finds that note.
- Chips, hover cards and the "Currently: …" line show the same text as before.

Test steps:
1. Create a test note whose title is about 120 characters, ending in "flamingo". Give its page a text box with a long paragraph.
2. In another text box, press Cmd+K and expand the test note and its page in the tree. Each row's name is at most 40 characters plus "…", hovering shows the full name, and the dialog has no sideways scrollbar (its `scrollWidth` equals its `clientWidth`).
3. Search "flamingo": the test note shows.
4. Open a sticky note, press Cmd+K and expand the same rows: there's still no sideways scroll.
5. Delete the test note and the sticky note.

## Progress

<!-- /kit:dev-loop adds one line here per finished task, in the same commit as the task. -->
- [x] T1 Pasting over an auto-text link or chip replaces it
- [x] T2 Re-embedding a web link updates its text
