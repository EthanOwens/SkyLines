"use client";

// Format actions shared by the Ribbon's Format tab and the bubble menus.

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

// Components outside the editor's render cycle read this through
// useEditorState, because the editor's identity doesn't change when marks or
// the selection do.
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
  // null when no highlight is active; "" when active without an explicit color.
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

// Image and link insertion need component state, so the Ribbon handles them
// itself.
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

// Small fixed sets. An empty value means "unset" (the editor's default).
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

// These set the highlight mark's own color (multicolor mode), unlike
// TEXT_COLORS, which use the textStyle mark.
export const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
];

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
