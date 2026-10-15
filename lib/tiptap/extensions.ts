import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { ListTabKeymap, ShortOrderedListInputRule } from "./listKeymap";
import { FollowOnClick, ReferenceNode, ReferencePaste } from "./reference";

const lowlight = createLowlight(common);

export interface EditorExtensionOptions {
  placeholder?: string;
  highlight?: boolean;
}

// Shared by every Tiptap editor so stored content stays compatible between
// the main editor, sticky notes and canvas text boxes.
export function createEditorExtensions({
  placeholder = "Start writing…",
  highlight = false,
}: EditorExtensionOptions = {}): Extensions {
  const extensions: Extensions = [
    // StarterKit bundles Link; clicks on links are handled by FollowOnClick.
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
    Image.configure({ inline: false, allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    CodeBlockLowlight.configure({ lowlight }),
    // FontFamily, FontSize and Color all need TextStyle registered first.
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    ListTabKeymap,
    ShortOrderedListInputRule,
    ReferenceNode,
    ReferencePaste,
    FollowOnClick,
  ];
  if (highlight) {
    // multicolor so highlights can use HIGHLIGHT_COLORS.
    extensions.push(Highlight.configure({ multicolor: true }));
  }
  return extensions;
}
