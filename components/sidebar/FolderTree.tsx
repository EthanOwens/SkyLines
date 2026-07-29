"use client";

import { useAppStore } from "@/stores/appStore";
import { FolderItem } from "./FolderItem";
import { NoteItem } from "./NoteItem";

// Ported unchanged from ../note_taking_app/components/sidebar/FolderTree.tsx
// (spec.md subtask 16) - reads folders/notes from stores/appStore.ts, which
// hooks/useFolders.ts and hooks/useNotes.ts populate from the SQLite layer
// (subtask 15), instead of this component subscribing to Firestore directly.

interface Props {
  userId: string;
}

export function FolderTree({ userId }: Props) {
  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);

  // Notes not inside any folder
  const rootNotes = notes.filter((n) => !n.folderId);
  // Folders at the root level
  const rootFolders = folders.filter((f) => !f.parentId);

  return (
    <div className="py-1 text-sm">
      {rootFolders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          allFolders={folders}
          allNotes={notes}
          userId={userId}
          depth={0}
        />
      ))}
      {rootNotes.map((note) => (
        <NoteItem key={note.id} note={note} userId={userId} depth={0} />
      ))}
      {folders.length === 0 && notes.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No notes yet. Use the toolbar above to create one.
        </p>
      )}
    </div>
  );
}
