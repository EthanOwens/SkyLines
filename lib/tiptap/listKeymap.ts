import { Extension, wrappingInputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

function innermostListItemType(editor: Editor): NodeType | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type;
    if (LIST_ITEM_TYPES.has(type.name)) return type;
  }
  return null;
}

// Mirrors the range test inside ProseMirror's liftListItem: it lifts into the
// outer list only when the selected items' list sits inside another item, and
// otherwise lifts them out of the list entirely, which Shift+Tab must not do.
function isNestedListSelection(editor: Editor, itemType: NodeType): boolean {
  const { $from, $to } = editor.state.selection;
  const range = $from.blockRange(
    $to,
    (node) => node.childCount > 0 && node.firstChild?.type === itemType,
  );
  return !!range && range.depth >= 2 && $from.node(range.depth - 1).type === itemType;
}

// Tab / Shift+Tab always report handled so the browser never moves focus out
// of the editor or inserts a tab, even when there is nothing to indent.
export const ListTabKeymap = Extension.create({
  name: "listTabKeymap",
  // Runs before the stock listItem / taskItem Tab bindings.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const itemType = innermostListItemType(editor);
        if (itemType) editor.commands.sinkListItem(itemType.name);
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const itemType = innermostListItemType(editor);
        if (itemType && isNestedListSelection(editor, itemType)) {
          editor.commands.liftListItem(itemType.name);
        }
        return true;
      },
    };
  },
});

// "1 " starts a numbered list like the stock "1. " rule. Only the digit 1, so
// lines such as "3 apples" or "2024 recap" stay as text.
export const ShortOrderedListInputRule = Extension.create({
  name: "shortOrderedListInputRule",

  addInputRules() {
    const type = this.editor.schema.nodes.orderedList;
    if (!type) return [];
    return [
      wrappingInputRule({
        find: /^1\s$/,
        type,
        getAttributes: { start: 1 },
        // Same join test as the stock "1. " rule.
        joinPredicate: (_match, node) =>
          (!node.attrs.type || node.attrs.type === "1") && node.childCount + node.attrs.start === 1,
      }),
    ];
  },
});
