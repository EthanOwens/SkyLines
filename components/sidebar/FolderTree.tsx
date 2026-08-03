"use client";

import { useAppStore } from "@/stores/appStore";
import { FolderItem } from "./FolderItem";
import { NoteItem } from "./NoteItem";

// Ported from ../note_taking_app/components/sidebar/FolderTree.tsx (spec.md
// subtask 16) - reads folders/notes from stores/appStore.ts, which
// hooks/useFolders.ts and hooks/useNotes.ts populate from the SQLite layer
// (subtask 15), instead of this component subscribing to Firestore directly.
//
// Notebook-scoped (spec.md subtask 7): `folders`/`notes` in the store are
// NOT pre-filtered by notebook (useFolders/useNotes fetch everything for the
// signed-in user across all notebooks), so this component itself restricts
// what it renders to the given `notebookId`. Only the ROOT level needs an
// explicit `notebookId` filter - `FolderItem`'s recursive descent below only
// ever walks a folder's children by `parentId` within `allFolders`/
// `allNotes`, and every folder's `parentId` chain necessarily bottoms out at
// one of these already-notebook-scoped root folders (folders don't move
// between notebooks by being nested - see `FolderItem.tsx`'s `addSubfolder`
// comment), so a folder/note nested under a scoped root folder can never
// belong to a different notebook. Filtering only the root level is
// therefore sufficient; `FolderItem`/`NoteItem` don't need a `notebookId`
// prop threaded down to them.

interface Props {
  userId: string;
  notebookId: string;
}

export function FolderTree({ userId, notebookId }: Props) {
  const folders = useAppStore((s) => s.folders);
  const notes = useAppStore((s) => s.notes);

  // Notes not inside any folder, scoped to this notebook.
  const rootNotes = notes.filter((n) => !n.folderId && n.notebookId === notebookId);
  // Folders at the root level, scoped to this notebook.
  const rootFolders = folders.filter((f) => !f.parentId && f.notebookId === notebookId);

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
      {rootFolders.length === 0 && rootNotes.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No notes yet. Use the toolbar above to create one.
        </p>
      )}
    </div>
  );
}
