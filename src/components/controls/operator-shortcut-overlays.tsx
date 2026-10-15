import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import { shortcutDefinitions } from "@/lib/shortcut-registry"
import { useOperatorUiStore } from "@/lib/operator-ui"
import {
  paletteCommands,
  browsePaletteReference,
  type PaletteCommand,
} from "@/lib/operator-palette"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
export function OperatorShortcutOverlays() {
  const commandsOpen = useOperatorUiStore((state) => state.commandsOpen)
  const shortcutsOpen = useOperatorUiStore((state) => state.shortcutsOpen)
  const translations = useBibleStore((state) => state.translations)
  const themes = useBroadcastStore((state) => state.themes)
  const commands = useMemo(
    () => paletteCommands(translations, themes),
    [translations, themes]
  )
  const [query, setQuery] = useState("")
  const pending = useRef<PaletteCommand["run"] | null>(null)
  function closePalette() {
    useOperatorUiStore.setState({ commandsOpen: false })
    setQuery("")
  }
  function choose(command: PaletteCommand) {
    pending.current = command.run
    closePalette()
  }
  return (
    <>
      <Dialog
        open={shortcutsOpen}
        onOpenChange={(open) =>
          useOperatorUiStore.setState({ shortcutsOpen: open })
        }
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Mod means ⌘ on macOS or Ctrl on Windows/Linux. Verbs pause while
              typing, composing, or using a dialog or menu. G chords expire
              after one second.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {[...new Set(shortcutDefinitions.map((item) => item.group))].map(
              (group) => (
                <section key={group}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    {group}
                  </h3>
                  <dl className="space-y-2">
                    {shortcutDefinitions
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-4 text-sm"
                        >
                          <dt>{item.label}</dt>
                          <dd className="shrink-0 rounded border bg-muted px-2 py-0.5 font-mono text-xs">
                            {item.bindings.join(" / ")}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            List movement changes focus; Enter presents. Delete removes only
            from Queue. Mod+Enter presents and clears Queue selection, retaining
            the row. Escape closes the current dialog; outside an editor/dialog
            it leaves reading mode.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={commandsOpen}
        onOpenChange={(open) => {
          if (open) useOperatorUiStore.setState({ commandsOpen: true })
          else closePalette()
        }}
      >
        <DialogContent
          className="overflow-hidden p-0 sm:max-w-xl"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            const run = pending.current
            pending.current = null
            if (run) {
              event.preventDefault()
              void Promise.resolve()
                .then(run)
                .catch((error: unknown) =>
                  toast.error("Command failed", {
                    description:
                      error instanceof Error ? error.message : String(error),
                  })
                )
            }
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Operator commands</DialogTitle>
            <DialogDescription>
              Search commands or enter a full verse reference to browse.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput
              aria-label="Search operator commands"
              placeholder="Command or full reference, e.g. John 3:16"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                No matching command. Use a full book name for a verse.
              </CommandEmpty>
              {/\d+\s*[:.]\s*\d+\s*$/.test(query) && (
                <CommandItem
                  value={`Browse ${query}`}
                  onSelect={() =>
                    choose({
                      id: "browse-reference",
                      label: `Browse ${query}`,
                      run: () => browsePaletteReference(query),
                    })
                  }
                >
                  Browse {query} in Bible
                </CommandItem>
              )}
              {commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.label}
                  onSelect={() => choose(command)}
                >
                  {command.label}
                  {command.hint && (
                    <CommandShortcut>{command.hint}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
