"use client";

// /note is kept only as a redirect to /canvas so old links and history entries
// still work; CanvasEditor migrates old Tiptap-only notes on open. replace() so
// the redirect doesn't leave its own history entry.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function NoteRedirectInner() {
  const router = useRouter();
  const id = useSearchParams().get("id");

  useEffect(() => {
    router.replace(id ? `/canvas?id=${id}` : "/canvas");
  }, [id, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export default function NotePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <NoteRedirectInner />
    </Suspense>
  );
}
