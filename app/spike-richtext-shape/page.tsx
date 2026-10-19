"use client";

// Dev-only verification page for RichTextShape. Renders CanvasEditor directly
// (instead of navigating to /canvas) so it can reach the live tldraw editor.
// Not production UI.

import { useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { AuthProvider, useAuthContext } from "@/components/AuthProvider";
import {
  getSyncStatus,
  scheduleDirtyPush,
  startSyncEngine,
  subscribeSyncStatus,
} from "@/lib/sync/engine";
import { subscribeDataChange } from "@/lib/db/events";
import { useAppStore } from "@/stores/appStore";
import { createNote, getNoteById } from "@/lib/db/notes";
import { getOrCreateDefaultNotebookId } from "@/lib/db/notebooks";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { Ribbon } from "@/components/ribbon/Ribbon";
import { createShapeId } from "@tldraw/tldraw";
import type { RichTextShape } from "@/components/canvas/RichTextShape";
import type { Note } from "@/types";

const TEST_EMAIL = "skylines-richtext-shape-verify@example.com";
const TEST_PASSWORD = "TestPassword123!";

// Exposes the editor on window so automation can inspect it without real
// clicks.
if (typeof window !== "undefined") {
  (window as unknown as { __appStore: typeof useAppStore }).__appStore = useAppStore;
}

function SpikeRichTextShapeInner() {
  const { user, loading } = useAuthContext();

  const [log, setLog] = useState<string[]>([]);
  const [manualId, setManualId] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [engineStarted, setEngineStarted] = useState(false);
  const createdNoteIdsRef = useRef<Set<string>>(new Set());
  const engineTeardownRef = useRef<(() => void) | null>(null);
  const lastShapeIdRef = useRef<string | null>(null);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function signIn() {
    try {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      } catch {
        cred = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      }
      append(`signed in -> userId=${cred.user.uid}`);
    } catch (err) {
      append(`SIGN IN FAILED: ${String(err)}`);
    }
  }

  async function doSignOut() {
    await signOut(auth);
    append("signed out");
  }

  function startEngine() {
    if (!user) return append("sign in first");
    if (engineTeardownRef.current) return append("engine already running");
    const uid = user.uid;
    useAppStore.getState().setSyncStatus(getSyncStatus());
    const unsubStatus = subscribeSyncStatus((s) => useAppStore.getState().setSyncStatus(s));
    const unsubDataChange = subscribeDataChange((origin) => {
      if (origin === "local") scheduleDirtyPush(uid);
    });
    const stopEngine = startSyncEngine(uid);
    engineTeardownRef.current = () => {
      unsubDataChange();
      unsubStatus();
      stopEngine();
    };
    setEngineStarted(true);
    append(`sync engine started -> syncStatus=${getSyncStatus()}`);
  }

  function stopEngine() {
    engineTeardownRef.current?.();
    engineTeardownRef.current = null;
    setEngineStarted(false);
    append("sync engine stopped");
  }

  async function createAndLoadNote() {
    if (!user) return append("sign in first");
    const notebookId = await getOrCreateDefaultNotebookId(user.uid);
    const id = await createNote(user.uid, "canvas", notebookId, null, "Spike RichTextShape Note");
    createdNoteIdsRef.current.add(id);
    setManualId(id);
    const n = await getNoteById(id);
    setNote(n);
    append(`created + loaded canvas note id=${id}`);
  }

  async function loadManualId() {
    if (!manualId) return append("enter a note id first");
    const n = await getNoteById(manualId);
    setNote(n);
    append(`loadManualId(${manualId}) -> ${n ? "found" : "NOT FOUND"}`);
  }

  function debugEditingShape() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor) return append("no active tldraw editor");
    append(`debug: editingShapeId=${String(editor.getEditingShapeId())} selectedShapeIds=${JSON.stringify(editor.getSelectedShapeIds())} currentToolId=${editor.getCurrentToolId()}`);
  }

  function debugListShapes() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor) return append("no active tldraw editor");
    const shapes = editor.getCurrentPageShapes().map((s) => ({
      id: s.id,
      type: s.type,
      x: Math.round(s.x),
      y: Math.round(s.y),
      content: (s as unknown as RichTextShape).props?.content ?? null,
    }));
    append(`debug: shapes=${JSON.stringify(shapes)}`);
  }

  function setToolSelect() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor) return append("no active tldraw editor");
    // setCurrentTool("select") does nothing while already inside select (for
    // example mid-edit), so force an exit and re-enter like tldraw's own
    // toolbar button.
    if (editor.isIn("select")) {
      const currentNode = editor.root.getCurrent()!;
      currentNode.exit({}, currentNode.id);
      currentNode.enter({}, currentNode.id);
    }
    editor.setCurrentTool("select");
    append(`set tool -> select, currentToolId=${editor.getCurrentToolId()}`);
  }

  function setToolRichText() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor) return append("no active tldraw editor");
    editor.setCurrentTool("rich-text");
    append(`set tool -> rich-text, currentToolId=${editor.getCurrentToolId()}`);
  }

  function createRichTextShape() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor) return append("no active tldraw editor - load a note first");
    const id = createShapeId();
    editor.createShape<RichTextShape>({
      id,
      type: "rich-text",
      x: 100,
      y: 100,
      props: { w: 320, h: 200, content: null },
    });
    lastShapeIdRef.current = id;
    append(`created RichTextShape id=${id} at (100,100)`);
  }

  function typeIntoLastShape() {
    const editor = useAppStore.getState().activeCanvasEditor;
    if (!editor || !lastShapeIdRef.current) return append("create a shape first");
    editor.setEditingShape(lastShapeIdRef.current as never);
    setTimeout(() => {
      const el = document.querySelector(`#${CSS.escape(lastShapeIdRef.current!)} .tiptap`);
      append(`found tiptap DOM el for shape: ${!!el}`);
    }, 50);
    append(`entered edit mode on shape=${lastShapeIdRef.current}`);
  }

  async function inspectNote() {
    if (!manualId) return append("enter a note id first");
    const n = await getNoteById(manualId);
    // tldraw snapshots keep records under document.store, not at the top level.
    const store = n?.canvasData
      ? ((n.canvasData as { document?: { store?: Record<string, unknown> } }).document?.store ?? {})
      : {};
    const shapes = Object.values(store).filter(
      (r: unknown) => (r as { typeName?: string })?.typeName === "shape",
    );
    append(`getNoteById(${manualId}) -> canvasData has ${shapes.length} shape(s): ${JSON.stringify(shapes)}`);
  }

  function trackManualIdForCleanup() {
    if (!manualId) return append("enter a note id first");
    createdNoteIdsRef.current.add(manualId);
    append(`manually tracked id=${manualId} for cleanup`);
  }

  async function cleanup() {
    try {
      stopEngine();
      for (const id of createdNoteIdsRef.current) {
        await deleteDoc(doc(db, "notes", id)).catch(() => {});
      }
      append(`deleted ${createdNoteIdsRef.current.size} test firestore note docs`);
      createdNoteIdsRef.current.clear();

      await new Promise((r) => setTimeout(r, 200));

      try {
        if (auth.currentUser) {
          await auth.currentUser.delete();
          append("deleted test auth user");
        } else {
          const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
          await cred.user.delete();
          append("re-signed-in and deleted test auth user");
        }
      } catch (err) {
        append(`initial delete-user attempt failed (${String(err)}), retrying with fresh credential`);
        const cred = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
        await cred.user.delete();
        append("re-signed-in with fresh credential and deleted test auth user");
      }
    } catch (err) {
      append(`CLEANUP FAILED (delete test data/user manually): ${String(err)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Spike RichTextShape</h1>
      <p className="text-sm" data-testid="spike-richtext-auth">
        loading={String(loading)} user={user?.uid ?? "null"} engineStarted={String(engineStarted)} noteId=
        {note?.id ?? "null"}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => void signIn()} className="rounded bg-blue-500 px-4 py-2 text-white">
          1. Sign in
        </button>
        <button onClick={startEngine} className="rounded bg-teal-600 px-4 py-2 text-white">
          2. Start sync engine
        </button>
        <button onClick={() => void createAndLoadNote()} className="rounded bg-green-600 px-4 py-2 text-white">
          3. Create + load note
        </button>
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="note id"
          className="rounded border border-border px-2 py-1 text-sm"
          data-testid="spike-richtext-manual-id"
        />
        <button onClick={() => void loadManualId()} className="rounded bg-indigo-600 px-4 py-2 text-white">
          4. Load note above
        </button>
        <button onClick={createRichTextShape} className="rounded bg-orange-600 px-4 py-2 text-white">
          5. Create RichTextShape at (100,100)
        </button>
        <button onClick={debugEditingShape} className="rounded bg-gray-600 px-4 py-2 text-white">
          debug: editingShapeId
        </button>
        <button onClick={debugListShapes} className="rounded bg-gray-700 px-4 py-2 text-white">
          debug: list shapes
        </button>
        <button onClick={setToolSelect} className="rounded bg-slate-600 px-4 py-2 text-white">
          debug: set tool select
        </button>
        <button onClick={setToolRichText} className="rounded bg-slate-700 px-4 py-2 text-white">
          debug: set tool rich-text
        </button>
        <button onClick={typeIntoLastShape} className="rounded bg-orange-800 px-4 py-2 text-white">
          6. Enter edit mode on last shape
        </button>
        <button onClick={() => void inspectNote()} className="rounded bg-purple-600 px-4 py-2 text-white">
          7. Inspect canvasData via getNoteById
        </button>
        <button onClick={trackManualIdForCleanup} className="rounded bg-amber-600 px-4 py-2 text-white">
          8. Track id above for cleanup
        </button>
        <button onClick={() => void doSignOut()} className="rounded bg-teal-800 px-4 py-2 text-white">
          9. Sign out
        </button>
        <button onClick={() => void cleanup()} className="rounded bg-red-600 px-4 py-2 text-white">
          10. Cleanup (delete test data + user, stops engine)
        </button>
      </div>
      <ul data-testid="spike-richtext-log" className="w-full max-w-3xl text-sm">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <div data-testid="spike-richtext-ribbon">
        <Ribbon />
      </div>
      <div className="relative h-[600px] w-full border border-border" data-testid="spike-richtext-canvas">
        {note ? <CanvasEditor key={note.id} note={note} /> : <div className="p-4">No note loaded.</div>}
      </div>
    </div>
  );
}

export default function SpikeRichTextShapePage() {
  return (
    <AuthProvider>
      <SpikeRichTextShapeInner />
    </AuthProvider>
  );
}
