"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Menu } from "@base-ui/react/menu";
import { Check, Link2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { copyReference } from "@/lib/references/copy";
import type { Reference } from "@/lib/references/format";

// "Copy reference" menu item. The app has no toast, so the item stays open
// showing "Copied" for a moment, then calls onDone to close its menu.

const FLASH_MS = 700;

type Status = "idle" | "copied" | "failed";

interface Props {
  reference: Reference;
  onDone: () => void;
}

export function CopyReferenceItem({ reference, onDone }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleClick() {
    if (status !== "idle") return;
    try {
      await copyReference(reference);
      setStatus("copied");
    } catch (err) {
      console.error("Copy reference failed", err);
      setStatus("failed");
    }
    timer.current = setTimeout(onDone, FLASH_MS);
  }

  return (
    <DropdownMenuItem closeOnClick={false} onClick={() => void handleClick()}>
      {status === "copied" ? (
        <>
          <Check className="mr-2 h-4 w-4" /> Copied
        </>
      ) : status === "failed" ? (
        <>
          <Link2 className="mr-2 h-4 w-4" /> Couldn&apos;t copy
        </>
      ) : (
        <>
          <Link2 className="mr-2 h-4 w-4" /> Copy reference
        </>
      )}
    </DropdownMenuItem>
  );
}

// For rows whose items render in both a "···" menu and a right-click menu:
// pass actionsRef to both roots, and closeMenus closes whichever is open.
export function useMenuCloser() {
  const actionsRef = useRef<Menu.Root.Actions | null>(null);
  const contextActionsRef = useRef<Menu.Root.Actions | null>(null);
  const closeMenus = useCallback(() => {
    actionsRef.current?.close();
    contextActionsRef.current?.close();
  }, []);
  return { actionsRef, contextActionsRef, closeMenus };
}
