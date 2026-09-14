"use client";

// Formatting-action definitions for the ribbon's Format tab (spec.md
// subtask 10, "Format tab") - ported from the toggle/insert logic that used
// to live in components/editor/EditorToolbar.tsx. Pulled into its own
// module (rather than inlined in Ribbon.tsx) so subtask 11's bubble menu
// can reuse the same action list/state selector without duplicating the
// editor-command wiring.

import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
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
} from "lucide-react";

// The reactive slice of editor state the Format tab (and, later, the bubble
// menu) needs to render active/disabled states. Read via Tiptap's
// `useEditorState` hook (see Ribbon.tsx) rather than calling
// `editor.isActive(...)` directly in render - the `editor` object's
// identity does not change when marks/selection change, so components
// outside the editor's own re-render cycle (like Ribbon, a sibling of
// RichTextEditor.tsx rather than a descendant) need this explicit
// subscription to stay in sync.
export interface FormatActionState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  link: string | null;
  canUndo: boolean;
  canRedo: boolean;
  fontFamily: string;
  fontSize: string;
  color: string;
  // `null` when no highlight mark is active at all; `""` when active but with
  // no explicit `color` attribute set (falls back to the mark's own default
  // styling); otherwise the active highlight's color.
  highlight: string | null;
}

export function selectFormatActionState(editor: Editor): FormatActionState {
  const textStyle = editor.getAttributes("textStyle");
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    link: editor.isActive("link") ? ((editor.getAttributes("link").href as string | undefined) ?? "") : null,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    fontFamily: (textStyle.fontFamily as string | undefined) ?? "",
    fontSize: (textStyle.fontSize as string | undefined) ?? "",
    color: (textStyle.color as string | undefined) ?? "",
    highlight: editor.isActive("highlight")
      ? ((editor.getAttributes("highlight").color as string | undefined) ?? "")
      : null,
  };
}

export interface FormatAction {
  id: string;
  tip: string;
  icon: LucideIcon;
  isActive: (state: FormatActionState) => boolean;
  isDisabled?: (state: FormatActionState) => boolean;
  run: (editor: Editor) => void;
}

// Undo/redo, marks, headings, lists, blockquote, divider - ported 1:1 from
// EditorToolbar.tsx. Insert-image/insert-link are intentionally NOT here:
// they need component-local state (a file input ref / a `window.prompt`
// call), so they're handled directly in Ribbon.tsx, same as
// EditorToolbar.tsx originally did.
export const formatActions: FormatAction[] = [
  { id: "undo", tip: "Undo", icon: Undo, isActive: () => false, isDisabled: (s) => !s.canUndo, run: (e) => e.chain().focus().undo().run() },
  { id: "redo", tip: "Redo", icon: Redo, isActive: () => false, isDisabled: (s) => !s.canRedo, run: (e) => e.chain().focus().redo().run() },
  { id: "bold", tip: "Bold", icon: Bold, isActive: (s) => s.bold, run: (e) => e.chain().focus().toggleBold().run() },
  { id: "italic", tip: "Italic", icon: Italic, isActive: (s) => s.italic, run: (e) => e.chain().focus().toggleItalic().run() },
  { id: "strike", tip: "Strikethrough", icon: Strikethrough, isActive: (s) => s.strike, run: (e) => e.chain().focus().toggleStrike().run() },
  { id: "code", tip: "Inline code", icon: Code, isActive: (s) => s.code, run: (e) => e.chain().focus().toggleCode().run() },
  { id: "h1", tip: "Heading 1", icon: Heading1, isActive: (s) => s.heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2", tip: "Heading 2", icon: Heading2, isActive: (s) => s.heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", tip: "Heading 3", icon: Heading3, isActive: (s) => s.heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "bulletList", tip: "Bullet list", icon: List, isActive: (s) => s.bulletList, run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "orderedList", tip: "Numbered list", icon: ListOrdered, isActive: (s) => s.orderedList, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "taskList", tip: "Task list", icon: CheckSquare, isActive: (s) => s.taskList, run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "blockquote", tip: "Blockquote", icon: Quote, isActive: (s) => s.blockquote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "hr", tip: "Divider", icon: Minus, isActive: () => false, run: (e) => e.chain().focus().setHorizontalRule().run() },
];

// Small fixed sets rather than an open-ended picker, per spec.md subtask
// 10's explicit guidance ("don't over-engineer"). Empty-string value means
// "unset" (falls back to the editor's default styling).
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans", value: "Arial, Helvetica, sans-serif" },
  { label: "Mono", value: "'Courier New', Courier, monospace" },
];

export const FONT_SIZES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Small", value: "12px" },
  { label: "Normal", value: "16px" },
  { label: "Large", value: "20px" },
  { label: "X-Large", value: "28px" },
];

export const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
];

export function applyFontFamily(editor: Editor, value: string) {
  if (value) editor.chain().focus().setFontFamily(value).run();
  else editor.chain().focus().unsetFontFamily().run();
}

export function applyFontSize(editor: Editor, value: string) {
  if (value) editor.chain().focus().setFontSize(value).run();
  else editor.chain().focus().unsetFontSize().run();
}

export function applyTextColor(editor: Editor, value: string) {
  if (value) editor.chain().focus().setColor(value).run();
  else editor.chain().focus().unsetColor().run();
}

// Highlight-mark color swatches (spec.md M3 subtask 6, bubble menu). Uses
// `@tiptap/extension-highlight`'s `multicolor: true` mode (registered in
// RichTextShape.tsx's extensions list), so - unlike `TEXT_COLORS` above,
// which stores its color on a shared `textStyle` mark - each swatch here
// sets the `highlight` mark's own `color` attribute directly.
export const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
];

// The color a plain "toggle highlight" click (no explicit swatch picked)
// applies - mirrors highlighter-pen tools elsewhere defaulting to yellow.
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value;

export function toggleHighlight(editor: Editor) {
  if (editor.isActive("highlight")) {
    editor.chain().focus().unsetHighlight().run();
  } else {
    editor.chain().focus().setHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run();
  }
}

export function applyHighlightColor(editor: Editor, value: string) {
  if (value) editor.chain().focus().setHighlight({ color: value }).run();
  else editor.chain().focus().unsetHighlight().run();
}
