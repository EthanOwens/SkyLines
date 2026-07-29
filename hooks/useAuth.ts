"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Ported unchanged from ../note_taking_app/hooks/useAuth.ts (spec.md
// subtask 15). Firebase Auth itself isn't touched by this rewrite yet - see
// spec.md subtask 21 - so this only ever needed lib/firebase.ts's `auth`,
// which already exists identically in this repo.

export function useAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
}
