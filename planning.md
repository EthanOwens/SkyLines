Things to update:
- Add the ability to resize the note and pages sidebars
- Add the ability to add in a table to the canvas
  - Remove the File tab at the top ribbon (the one with File, format, draw). And add in Insert (this is where things like adding in a table will go)
  - Ideally I'd like these tables to have the same functionality of excel spreadsheet tables



Bugs to fix:
- Syncing while using the app on 2 devices at once is buggy
  - It doesn't show the changes in real time (ideally real time, but with a delay is fine too)
  - It can crash the app (it crashed when I tried to make a new page in a note that I had updated on my laptop)

Sync consistency (stale local copies on a second device):
- Add a "catching up" state on startup/resume
  - Show an indicator until the first server snapshot has settled (reuse the pull's first-snapshot signal)
  - Only lock editing while online, and only for a few seconds with a timeout; never block when starting offline (the server snapshot never arrives)
- Add a conflicts and backups screen (like the History tab)
  - Losing versions are already saved in `sync_conflicts`; let me view and restore them
  - Restoring counts as an ordinary edit with a fresh updatedAt
  - A periodic whole-database snapshot is lower priority (images could make it large)
- Audit what marks a note or page dirty on open
  - The CanvasEditor migrations already only save when they changed something
  - Check the general autosave listeners skip no-op saves; compare against the last saved version when saving, not a deep compare on every change
- Reconcile rows that were hard-deleted elsewhere (zombies on stale devices)
  - Needed because "Empty history" deletes the Firestore doc immediately, and pull ignores "removed" events
  - Riskiest item, so guardrails: only run after a complete first snapshot from the server (not cache); never when the snapshot is empty but local data isn't; soft-delete the local row (so it shows in History) instead of hard-deleting; never touch dirty rows
- Later, only if the above don't settle it: version counters with a transactional push instead of device-clock last-write-wins
  - Not worth doing: serverTimestamp() for updatedAt (an offline edit would be stamped at upload time and beat a genuinely later edit)
