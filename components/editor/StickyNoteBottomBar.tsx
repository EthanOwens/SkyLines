"use client";

// Formatting bar for a sticky note window. There's no underline action because
// no Underline mark is registered.
//
// Fades out while the window is unfocused instead of unmounting, and is hidden
// entirely while the note is collapsed (no room). Reads this window's own
// editor rather than the store's activeEditor.

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
  /** Whether the note is manually collapsed to COLLAPSED_HEIGHT - owned by StickyNoteEditor.tsx. */
  collapsed: boolean;
}

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

export function StickyNoteBottomBar({ editor, focused, collapsed }: Props) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => (editor ? selectFormatActionState(editor) : null),
  });

  // editor starts null and useEditorState doesn't refresh when it arrives
  // without a transaction (see TopBar's tiptapUndoState), so compute the state
  // directly until it does.
  const displayState = state ?? (editor && !editor.isDestroyed ? selectFormatActionState(editor) : null);

  if (collapsed || !editor || !displayState) return null;

  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 overflow-hidden border-border px-2 transition-all duration-200 ease-in-out ${
        focused ? "h-9 border-t opacity-100" : "h-0 border-t-0 opacity-0"
      }`}
    >
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
