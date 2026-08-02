"use client";

import { useMemo, useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";
import { useAppStore } from "@/stores/appStore";
import { createNotebook } from "@/lib/db/notebooks";
import { setLastOpenNotebook } from "@/lib/lastOpen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Notebook picker (spec.md subtask 6, "Notebook picker"): the landing UI
// shown when there's no valid last-open note - either first login (no
// notebooks/notes exist yet), or a stored last-open state that only got as
// far as "a notebook is open, no note chosen yet" (AppShell.tsx's restore
// effect populates `selectedNotebookId` from that stored state before this
// component ever renders, so this component doesn't need to re-derive it
// from localStorage itself).
export default function Home() {
  const { user } = useAuthContext();
  const notebooks = useAppStore((s) => s.notebooks);
  const notebooksLoaded = useAppStore((s) => s.notebooksLoaded);
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId);
  const setSelectedNotebook = useAppStore((s) => s.setSelectedNotebook);

  const [newNotebookName, setNewNotebookName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNotebook = useMemo(
    () => notebooks.find((n) => n.id === selectedNotebookId) ?? null,
    [notebooks, selectedNotebookId],
  );

  function openNotebook(id: string) {
    setSelectedNotebook(id);
    setLastOpenNotebook(id);
  }

  async function handleCreate() {
    const name = newNotebookName.trim();
    if (!name || !user) return;

    setError(null);
    setCreating(true);
    try {
      const id = await createNotebook(user.uid, name);
      setNewNotebookName("");
      openNotebook(id);
    } catch {
      setError("Failed to create notebook. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  // A `selectedNotebookId` that no longer matches any notebook in the store
  // (e.g. it was deleted on another device, or restored from a stale
  // localStorage entry) falls through to the picker below rather than
  // rendering a confirmation for a notebook that doesn't exist.
  if (selectedNotebookId && selectedNotebook) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2">
        <h1 className="text-xl font-semibold">
          Notebook &quot;{selectedNotebook.name}&quot; is open
        </h1>
        <p className="text-sm text-muted-foreground">
          Sidebar/note view coming in a later subtask.
        </p>
      </div>
    );
  }

  // `notebooks` is populated asynchronously (hooks/useNotebooks.ts's SQLite
  // fetch). Until the first fetch resolves, neither "selectedNotebookId not
  // found above" nor "notebooks is empty" below can be trusted - both just
  // mean "not loaded yet", not "doesn't exist" / "user has none". Render a
  // neutral loading state instead of falsely falling through to the
  // "notebook not found" picker (in particular its "no notebooks yet"
  // empty-state message).
  if (!notebooksLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-xl font-semibold">Your Notebooks</h1>

        {notebooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any notebooks yet. Create one to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <button
                  type="button"
                  onClick={() => openNotebook(notebook.id)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {notebook.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            value={newNotebookName}
            onChange={(e) => setNewNotebookName(e.target.value)}
            placeholder="New notebook name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            disabled={creating}
          />
          <Button
            onClick={() => void handleCreate()}
            disabled={creating || !newNotebookName.trim()}
          >
            Create
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
