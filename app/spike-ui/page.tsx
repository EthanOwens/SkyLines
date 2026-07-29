"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// M4 shared-UI spike route (spec.md subtask 19). Verifies the newly ported
// dialog.tsx and input.tsx primitives render and interact correctly with
// the installed @base-ui/react version before any real consumer exists.
export default function SpikeUi() {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Spike UI</h1>
      <Input
        placeholder="Type something"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p data-testid="input-value">Value: {value}</p>
      <Dialog>
        <DialogTrigger render={<Button>Open dialog</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Spike Dialog</DialogTitle>
            <DialogDescription>
              This dialog verifies the ported dialog.tsx primitive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
