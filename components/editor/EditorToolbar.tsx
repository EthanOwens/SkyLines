"use client";

// Ported from ../note_taking_app/components/editor/EditorToolbar.tsx (spec.md
// subtask 17, M4 "rich text editor"). One mechanical adaptation: the
// reference's `ToolbarBtn` helper used `<TooltipTrigger asChild><Button
// .../></TooltipTrigger>`, which doesn't exist on the actually-installed
// `@base-ui/react@1.3.0` - rewritten to `<TooltipTrigger render={<Button
// .../>} />` matching the pattern already established in
// components/ui/tooltip.tsx and components/sidebar/Sidebar.tsx (subtask 16).
// `SyncStatus` below already just reads `useAppStore((s) => s.syncStatus)`
// and is ported unchanged - the store's `syncStatus` is already real, wired
// in subtask 15.

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Undo,
  Redo,
  ImageIcon,
  Link as LinkIcon,
} from "lucide-react";
import { useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { CheckCircle2, Loader2, CloudOff, Cloud } from "lucide-react";

function ToolbarBtn({
  onClick,
  active,
  tip,
  children,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  tip: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
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

function SyncStatus() {
  const status = useAppStore((s) => s.syncStatus);
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto pr-2">
      {status === "syncing" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
      {status === "saved" && <><CheckCircle2 className="h-3 w-3 text-green-500" /> Saved</>}
      {status === "offline" && <><CloudOff className="h-3 w-3 text-yellow-500" /> Offline</>}
      {status === "error" && <><Cloud className="h-3 w-3 text-destructive" /> Error</>}
    </div>
  );
}

interface Props {
  editor: Editor | null;
}

export function EditorToolbar({ editor }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!editor) return <div className="h-10 border-b border-border" />;

  // TypeScript's control-flow narrowing from the `if (!editor) return ...`
  // check above doesn't extend into nested function declarations (they're
  // hoisted and could, in principle, be invoked before the check runs) -
  // capturing the already-narrowed value in a local const here lets
  // `insertImage`/`setLink` below use it without a `possibly null` error.
  // (This is a pre-existing TS strictness gap in the ported reference file
  // too - confirmed via `tsc`/`next build` failing there identically - not
  // introduced by this port; fixed here because this repo's build actually
  // needs to succeed.)
  const currentEditor = editor;

  function insertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        currentEditor.chain().focus().setImage({ src: reader.result }).run();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function setLink() {
    const prev = currentEditor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      currentEditor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      currentEditor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  return (
    <div className="flex h-10 items-center gap-0.5 border-b border-border px-2 overflow-x-auto shrink-0">
      <ToolbarBtn tip="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToolbarBtn tip="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToolbarBtn tip="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToolbarBtn tip="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Task list" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <CheckSquare className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <ToolbarBtn tip="Insert image" onClick={() => fileInputRef.current?.click()}>
        <ImageIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn tip="Insert link" active={editor.isActive("link")} onClick={setLink}>
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={insertImage} />

      <SyncStatus />
    </div>
  );
}
