"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useAuthContext } from "@/components/AuthProvider";
import { useUserSettings } from "@/hooks/useUserSettings";
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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user } = useAuthContext();
  const settings = useUserSettings(user?.uid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Application settings</DialogDescription>
        </DialogHeader>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aesthetics
          </h3>
          {AESTHETICS.map(({ key, label, help }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label htmlFor={`setting-${key}`} className="text-sm font-medium">
                  {label}
                </label>
                <p className="text-xs text-muted-foreground">{help}</p>
              </div>
              <Switch
                id={`setting-${key}`}
                checked={settings[key]}
                onCheckedChange={(checked) => void settings.update({ [key]: checked })}
              />
            </div>
          ))}
        </section>
      </DialogContent>
    </Dialog>
  );
}
