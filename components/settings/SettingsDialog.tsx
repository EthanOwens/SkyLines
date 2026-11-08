"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuthContext } from "@/components/AuthProvider";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useDeletedNotes } from "@/hooks/useDeletedNotes";
import { restoreNote } from "@/lib/db/notes";
import { emptyNoteHistory, HISTORY_RETENTION_MS } from "@/lib/sync/cleanup";
import { Input } from "@/components/ui/input";
import {
  noteMatchesHistoryTerms,
  parseHistoryQuery,
} from "@/lib/history/search";
import { cn } from "@/lib/utils";
import type { UserSettingsValues } from "@/lib/db/userSettings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AESTHETICS: {
  key: keyof UserSettingsValues;
  label: string;
  help: string;
}[] = [
  {
    key: "autoColor",
    label: "Automatic color coding",
    help: "New notes and pages get a color automatically.",
  },
  {
    key: "colorBookend",
    label: "Color bookend",
    help: "Show a bar on the left of the note or page name.",
  },
  {
    key: "colorHighlight",
    label: "Color highlight",
    help: "Show a faded tint over the whole name card.",
  },
];

type TabId = "appearance" | "history";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: number): number {
  return Math.max(
    1,
    Math.ceil((deletedAt + HISTORY_RETENTION_MS - Date.now()) / DAY_MS),
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user } = useAuthContext();
  const settings = useUserSettings(user?.uid);
  const deleted = useDeletedNotes(user?.uid);
  const [tab, setTab] = useState<TabId>("appearance");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const terms = parseHistoryQuery(search);
    return deleted.filter((n) => noteMatchesHistoryTerms(n, terms));
  }, [deleted, search]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "appearance", label: "Appearance" },
    { id: "history", label: "History" },
  ];
  const activeTab = tab;

  async function handleEmpty() {
    if (!user) return;
    const skipped = await emptyNoteHistory(user.uid);
    setMessage(
      skipped > 0
        ? `${skipped} note${skipped === 1 ? "" : "s"} could not be removed yet because a deletion has not synced. Try again shortly.`
        : null,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Application settings
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-64 gap-4">
          <nav
            className="flex w-32 shrink-0 flex-col gap-1"
            aria-label="Settings sections"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-settings-tab={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                  activeTab === t.id && "bg-muted font-medium",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {activeTab === "appearance" && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Appearance
                </h3>
                {AESTHETICS.map(({ key, label, help }) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-4"
                  >
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor={`setting-${key}`}
                        className="text-sm font-medium"
                      >
                        {label}
                      </label>
                      <p className="text-xs text-muted-foreground">{help}</p>
                    </div>
                    <Switch
                      id={`setting-${key}`}
                      checked={settings[key]}
                      onCheckedChange={(checked) =>
                        void settings.update({ [key]: checked })
                      }
                    />
                  </div>
                ))}
              </section>
            )}
            {activeTab === "history" && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Deleted notes
                  </h3>
                  {deleted.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      data-history-empty
                      onClick={() => setConfirmEmpty(true)}
                    >
                      Empty history
                    </Button>
                  )}
                </div>
                {deleted.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-history-nothing
                  >
                    There is nothing to restore.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Deleted notes can be restored for 30 days.
                    </p>
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder='Search title, has:image, has:"text in note"'
                      aria-label="Search deleted notes"
                      data-history-search
                    />
                    {message && (
                      <p className="text-xs text-destructive">{message}</p>
                    )}
                    <ScrollArea
                      className="h-80 rounded-md border bg-muted/20"
                      data-history-list
                    >
                      <ul className="flex flex-col gap-1 p-1">
                        {visible.length === 0 && (
                          <li className="px-2 py-1.5 text-sm text-muted-foreground">
                            No matching notes.
                          </li>
                        )}
                        {visible.map((note) => {
                          const days = daysLeft(note.deletedAt as number);
                          return (
                            <li
                              key={note.id}
                              data-history-note={note.id}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm">
                                  {note.title || "Untitled"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {days} day{days === 1 ? "" : "s"} left
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                data-history-restore
                                onClick={() => void restoreNote(note.id)}
                              >
                                Restore
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </ScrollArea>
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      </DialogContent>
      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty history?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {deleted.length} note
              {deleted.length === 1 ? "" : "s"}. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmEmpty(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEmpty(false);
                void handleEmpty();
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
