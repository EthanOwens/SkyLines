"use client"

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

// Right-click ("contextmenu") entry point, additional to (not a replacement
// for) the existing "···" `DropdownMenu` trigger in components/ui/dropdown-
// menu.tsx (spec.md M4 subtask 8, "Right-click context menu"). Only `Root`/
// `Trigger` are wrapped here - the popup content itself
// (`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuSeparator`) is
// reused as-is from dropdown-menu.tsx rather than duplicated, since
// `@base-ui/react/context-menu`'s `Positioner`/`Popup`/`Item` are literally
// the same underlying `@base-ui/react/menu` primitives re-exported (see
// node_modules/@base-ui/react/context-menu/index.parts.js) - `ContextMenu`
// below renders a real `Menu.Root` internally (see `ContextMenuRoot.js`)
// with a `ContextMenuRootContext` provider around it that `MenuPositioner`
// auto-detects to anchor the popup at the cursor instead of a trigger
// element, so nesting `DropdownMenuContent` inside `ContextMenu` "just
// works" and stays pixel/behavior-identical to the "···" menu.

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

export { ContextMenu, ContextMenuTrigger }
