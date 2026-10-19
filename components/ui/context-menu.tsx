"use client"

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

// Only Root and Trigger are wrapped. Base UI's context menu is built on the
// same menu primitives, so DropdownMenuContent and its items render inside it
// unchanged, anchored at the cursor.

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

export { ContextMenu, ContextMenuTrigger }
