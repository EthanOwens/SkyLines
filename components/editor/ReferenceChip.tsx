"use client";

import { useEffect, useMemo } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useResolvedReference } from "@/lib/references/useResolvedReference";
import { formatReference, type ReferenceKind } from "@/lib/references/format";
import {
  referenceFromAttrs,
  referencePrefix,
  type ReferenceAttrs,
} from "@/lib/tiptap/reference";

const SEPARATOR = " › ";

// A shape's own title is just its text, so it keeps its note and page for
// context; everything else keeps only its parent.
function pathSegmentsShown(kind: ReferenceKind): number {
  return kind === "shape" ? 2 : 1;
}

export function ReferenceChipView({ node, editor, getPos }: ReactNodeViewProps) {
  const attrs = node.attrs as ReferenceAttrs;
  const { kind, id, pageId, shapeId, stickyId, label, lastTitle } = attrs;
  const ref = useMemo(
    () => referenceFromAttrs({ kind, id, pageId, shapeId, stickyId, label: null, lastTitle: null }),
    [kind, id, pageId, shapeId, stickyId],
  );
  const resolved = useResolvedReference(ref);
  const missing = !ref || resolved?.exists === false;
  const liveTitle = resolved?.exists ? resolved.title || "Untitled" : null;

  // Remember the live title so a deleted target can still be named. Only while
  // editable: a canvas text box that isn't being edited must not rewrite its
  // shape just because it rendered. Kept out of undo history.
  useEffect(() => {
    if (!liveTitle || liveTitle === lastTitle || editor.isDestroyed || !editor.isEditable) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== "reference") return;
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(pos, "lastTitle", liveTitle).setMeta("addToHistory", false),
    );
  }, [liveTitle, lastTitle, editor, getPos]);

  let text: string;
  if (label) text = label;
  else if (liveTitle && resolved) {
    const path = resolved.path.slice(-pathSegmentsShown(kind));
    text = [...path, liveTitle].join(SEPARATOR);
  } else if (lastTitle) text = lastTitle;
  else text = missing ? "Not found" : "…";

  // WebKit draws a caret before an uneditable inline at a line's start inside
  // that element's box. A zero-width text leaf ahead of the chip gives the
  // caret somewhere to sit outside it.
  return (
    <>
      {"\u200B"}
      <NodeViewWrapper
        as="span"
        className="reference-chip"
        data-kind={kind}
        data-reference-token={ref ? formatReference(ref) : undefined}
        data-missing={missing ? "" : undefined}
        contentEditable={false}
      >
        <span className="reference-chip-prefix">{referencePrefix({ kind, stickyId })}</span>
        <span className="reference-chip-text">{text}</span>
      </NodeViewWrapper>
    </>
  );
}
