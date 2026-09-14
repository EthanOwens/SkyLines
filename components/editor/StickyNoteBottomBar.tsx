"use client";

// spec.md subtask 10 ("Sticky note bottom bar"). Renders below the editor
// content in StickyNoteEditor.tsx. A compact subset of
// components/ribbon/formatActions.ts's existing actions (bold, italic,
// strikethrough, bullet list, task list) - same filtered-subset approach
// RichTextShape.tsx's own `BUBBLE_MENU_ACTION_IDS` already established,
// reused here rather than inventing a new one. There is no "underline"
// action in formatActions.ts (no Underline mark is registered anywhere in
// this app's editors), so it's intentionally omitted despite being named in
// spec.md.
//
// Focus/blur-gated the same way as StickyNoteTopBar.tsx: only shown while
// the OS window is focused. The `focused` prop and the underlying Tauri
// `Window.onFocusChanged` listener are owned by StickyNoteEditor.tsx and
// shared with the top bar, rather than this component subscribing again.
//
// Reads live editor state via Tiptap's `useEditorState` + `formatActions`'s
// own `selectFormatActionState` selector - mirrors Ribbon.tsx's `FormatTab`
// pattern (read state, then render one button per action), but against this
// window's own local `editor` instance (passed down directly as a prop)
// instead of the main window's global `activeEditor` (stores/appStore.ts) -
// that indirection is specific to the main ribbon and doesn't apply here.

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatActions, selectFormatActionState } from "@/components/ribbon/formatActions";

const BOTTOM_BAR_ACTION_IDS = ["bold", "italic", "strike", "bulletList", "taskList"];
const bottomBarActions = formatActions.filter((a) => BOTTOM_BAR_ACTION_IDS.includes(a.id));

interface Props {
  editor: Editor | null;
  /** Whether the OS window is currently focused - owned by StickyNoteEditor.tsx (shared with StickyNoteTopBar.tsx). */
  focused: boolean;
}

// Same small ghost icon-button shape as StickyNoteTopBar.tsx's local
// `TopBarBtn` - not literally shared since it's tuned to this bar's plain
// (non-colored) background, but mirrors its conventions.
function BottomBarBtn({
  onClick,
  tip,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  tip: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={onClick}
            disabled={disabled}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function StickyNoteBottomBar({ editor, focused }: Props) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  // `editor` starts null (immediatelyRender: false) and useEditorState's
  // snapshot doesn't get bumped when it later flips to a real instance
  // without an intervening transaction - same staleness class TopBar.tsx
  // works around (see its tiptapUndoState comment). Fall back to computing
  // the selector directly off the live editor so the bar doesn't stay
  // hidden until the user's first click/keystroke.
  const displayState = state ?? (editor && !editor.isDestroyed ? selectFormatActionState(editor) : null);

  if (!focused || !editor || !displayState) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-t border-border px-2">
      {bottomBarActions.map((action) => (
        <BottomBarBtn
          key={action.id}
          tip={action.tip}
          active={action.isActive(displayState)}
          disabled={action.isDisabled?.(displayState)}
          onClick={() => action.run(editor)}
        >
          <action.icon className="h-3.5 w-3.5" />
        </BottomBarBtn>
      ))}
    </div>
  );
}
