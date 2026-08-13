import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { info as logInfo, error as logError } from "@tauri-apps/plugin-log"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { availableMonitors, getAllWindows, type Monitor } from '@tauri-apps/api/window'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useBroadcastStore } from "@/stores"
import type { NdiAlphaMode, NdiFrameRate, NdiResolution, NdiSessionInfo, NdiStartRequest } from "@/types"
import {
  MonitorIcon,
  CastIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  RadioIcon,
} from "lucide-react"

type OutputType = "display" | "ndi"

const NDI_RESOLUTION_OPTIONS: Array<{ value: NdiResolution; label: string }> = [
  { value: "r1080p", label: "1080p (1920×1080)" },
  { value: "r720p", label: "720p (1280×720)" },
  { value: "r4k", label: "4K (3840×2160)" },
]

const NDI_FRAME_RATE_OPTIONS: Array<{ value: NdiFrameRate; label: string }> = [
  { value: "fps24", label: "24 fps" },
  { value: "fps30", label: "30 fps" },
  { value: "fps60", label: "60 fps" },
]

const NDI_ALPHA_OPTIONS: Array<{ value: NdiAlphaMode; label: string }> = [
  { value: "noneOpaque", label: "None (Opaque)" },
  { value: "straightAlpha", label: "Straight Alpha" },
  { value: "premultipliedAlpha", label: "Premultiplied Alpha" },
]

function ndiFrameRateToNumber(frameRate: NdiFrameRate): number {
  switch (frameRate) {
    case "fps24":
      return 24
    case "fps30":
      return 30
    case "fps60":
      return 60
  }
}

export function BroadcastSettings({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  // Main output state
  const [mainEnabled, setMainEnabled] = useState(false)
  const [mainThemeId, setMainThemeId] = useState(activeThemeId)
  const [outputType, setOutputType] = useState<OutputType>("display")
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [selectedMonitor, setSelectedMonitor] = useState("0")
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [ndiSourceName, setNdiSourceName] = useState("Rhema Output")
  const [ndiResolution, setNdiResolution] = useState<NdiResolution>("r1080p")
  const [ndiFrameRate, setNdiFrameRate] = useState<NdiFrameRate>("fps24")
  const [ndiAlphaMode, setNdiAlphaMode] = useState<NdiAlphaMode>("straightAlpha")
  const [ndiActive, setNdiActive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Alternate output state
  const altActiveThemeId = useBroadcastStore((s) => s.altActiveThemeId)
  const [altEnabled, setAltEnabled] = useState(false)
  const [altThemeId, setAltThemeId] = useState(altActiveThemeId)
  const [altOutputType, setAltOutputType] = useState<OutputType>("ndi")
  const [altSelectedMonitor, setAltSelectedMonitor] = useState("0")
  const [altIsPreviewOpen, setAltIsPreviewOpen] = useState(false)
  const [altNdiSourceName, setAltNdiSourceName] = useState("Rhema Alt")
  const [altNdiResolution, setAltNdiResolution] = useState<NdiResolution>("r1080p")
  const [altNdiFrameRate, setAltNdiFrameRate] = useState<NdiFrameRate>("fps24")
  const [altNdiAlphaMode, setAltNdiAlphaMode] = useState<NdiAlphaMode>("straightAlpha")
  const [altNdiActive, setAltNdiActive] = useState(false)

  const syncBroadcastOutput = useCallback(() => {
    useBroadcastStore.getState().syncBroadcastOutput()
  }, [])

  const syncNdiConfigToOutput = useCallback(
    (
      outputId: string,
      active: boolean,
      frameRate: NdiFrameRate,
      resolution: NdiResolution,
    ) => {
      const label = outputId === "alt" ? "broadcast-alt" : "broadcast"
      const dims =
        resolution === "r720p"
          ? { width: 1280, height: 720 }
          : resolution === "r4k"
            ? { width: 3840, height: 2160 }
            : { width: 1920, height: 1080 }
      void emitTo(label, "broadcast:ndi-config", {
        active,
        fps: ndiFrameRateToNumber(frameRate),
        width: dims.width,
        height: dims.height,
      }).catch(() => {})
    },
    [],
  )

  const reconcilePreviewState = useCallback(async (outputId: string = "main") => {
    const label = outputId === "alt" ? "broadcast-alt" : "broadcast"
    try {
      const windows = await getAllWindows()
      const window = windows.find((w) => w.label === label)
      // A window hidden for NDI still exists — only a visible one counts as
      // an open preview.
      return window ? await window.isVisible() : false
    } catch {
      return false
    }
  }, [])

  const fetchMonitors = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await availableMonitors()
      void logInfo(
        `[broadcast-ui] availableMonitors -> ${result.length}: ${result
          .map((m) => `${m.name ?? "?"} ${m.size.width}x${m.size.height}`)
          .join(", ")}`,
      )
      setMonitors(result)
      if (result.length > 0 && selectedMonitor === "0") {
        setSelectedMonitor("0")
      }
    } catch (error) {
      void logError(`[broadcast-ui] availableMonitors FAILED: ${String(error)}`)
      toast.error("Could not list monitors", { description: String(error) })
      setMonitors([])
    } finally {
      setRefreshing(false)
    }
  }, [selectedMonitor])

  useEffect(() => {
    if (open) fetchMonitors()
  }, [open, fetchMonitors])

  // Sync theme selection with broadcast store
  useEffect(() => {
    setMainThemeId(activeThemeId)
  }, [activeThemeId])

  useEffect(() => {
    if (!open) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const unlistenPromise = listen("broadcast:output-ready", () => {
      useBroadcastStore.getState().syncBroadcastOutput()
      syncNdiConfigToOutput("main", ndiActive, ndiFrameRate, ndiResolution)
      syncNdiConfigToOutput("alt", altNdiActive, altNdiFrameRate, altNdiResolution)
      timeoutId = setTimeout(() => {
        useBroadcastStore.getState().syncBroadcastOutput()
      }, 150)
    })

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [
    open,
    isPreviewOpen,
    ndiActive,
    ndiFrameRate,
    ndiResolution,
    altNdiActive,
    altNdiFrameRate,
    altNdiResolution,
    syncBroadcastOutput,
    syncNdiConfigToOutput,
  ])

  // Keep the preview buttons in sync with the actual windows: reconcile when
  // the dialog opens (the window may outlive a dialog close/reopen) and keep
  // polling so an OS-level close of the projector flips the button back.
  useEffect(() => {
    if (!open) return

    const reconcileBoth = () => {
      void reconcilePreviewState("main").then(setIsPreviewOpen)
      void reconcilePreviewState("alt").then(setAltIsPreviewOpen)
    }

    reconcileBoth()
    const intervalId = setInterval(reconcileBoth, 750)

    return () => {
      clearInterval(intervalId)
    }
  }, [open, reconcilePreviewState])

  const handleMainThemeChange = (id: string) => {
    setMainThemeId(id)
    useBroadcastStore.getState().setActiveTheme(id)
  }

  const handleTogglePreview = async () => {
    void logInfo(
      `[broadcast-ui] Open/Close Preview clicked: isPreviewOpen=${isPreviewOpen}, monitor=${selectedMonitor}, monitors=${monitors.length}`,
    )
    try {
      if (isPreviewOpen) {
        await invoke("close_broadcast_window", { outputId: "main" })
        setIsPreviewOpen(await reconcilePreviewState("main"))
      } else {
        await invoke("open_broadcast_window", {
          outputId: "main",
          monitorIndex: Number(selectedMonitor),
        })
        const opened = await reconcilePreviewState("main")
        void logInfo(`[broadcast-ui] open_broadcast_window ok, visible=${opened}`)
        setIsPreviewOpen(opened)
        if (!opened) return
        useBroadcastStore.getState().syncBroadcastOutputFor("main")
        syncNdiConfigToOutput("main", ndiActive, ndiFrameRate, ndiResolution)
        setTimeout(() => {
          useBroadcastStore.getState().syncBroadcastOutputFor("main")
        }, 150)
      }
    } catch (error) {
      void logError(`[broadcast-ui] toggle preview FAILED: ${String(error)}`)
      console.error("Failed to toggle preview window", error)
      toast.error("Could not toggle preview window", { description: String(error) })
    }
  }

  const handleToggleNdi = async () => {
    void logInfo(`[broadcast-ui] Start/Stop NDI clicked: ndiActive=${ndiActive}, source=${ndiSourceName}`)
    try {
      if (ndiActive) {
        await invoke("stop_ndi", { outputId: "main" })
        syncNdiConfigToOutput("main", false, ndiFrameRate, ndiResolution)
        setNdiActive(false)
        if (!isPreviewOpen) {
          await invoke("close_broadcast_window", { outputId: "main" }).catch(() => {})
        }
      } else {
        await invoke("ensure_broadcast_window", { outputId: "main" })
        const request: NdiStartRequest = {
          sourceName: ndiSourceName,
          resolution: ndiResolution,
          frameRate: ndiFrameRate,
          alphaMode: ndiAlphaMode,
        }
        const session = await invoke<NdiSessionInfo>("start_ndi", { outputId: "main", request })
        void logInfo(
          `[broadcast-ui] start_ndi ok: ${session.sourceName} ${session.width}x${session.height}@${session.fps}`,
        )
        setNdiActive(true)
        useBroadcastStore.getState().syncBroadcastOutputFor("main")
        void emitTo("broadcast", "broadcast:ndi-config", {
          active: true,
          fps: session.fps,
          width: session.width,
          height: session.height,
        }).catch(() => {})
        setTimeout(() => {
          useBroadcastStore.getState().syncBroadcastOutputFor("main")
          syncNdiConfigToOutput("main", true, ndiFrameRate, ndiResolution)
        }, 300)
      }
    } catch (error) {
      void logError(`[broadcast-ui] toggle NDI FAILED: ${String(error)}`)
      console.error("Failed to toggle NDI", error)
      toast.error(ndiActive ? "Could not stop NDI" : "Could not start NDI", {
        description: String(error),
      })
    }
  }

  const handleMainToggle = async (enabled: boolean) => {
    setMainEnabled(enabled)
    if (!enabled) {
      if (isPreviewOpen) {
        try {
          await invoke("close_broadcast_window", { outputId: "main" })
        } catch {
          console.error("Failed to close broadcast window")
        }
        setIsPreviewOpen(false)
      }
      if (ndiActive) {
        try {
          await invoke("stop_ndi", { outputId: "main" })
        } catch {
          console.error("Failed to stop NDI")
        }
        syncNdiConfigToOutput("main", false, ndiFrameRate, ndiResolution)
        setNdiActive(false)
      }
    }
  }

  // ── Alternate Output Handlers ──

  const handleAltThemeChange = (id: string) => {
    setAltThemeId(id)
    useBroadcastStore.getState().setAltActiveTheme(id)
  }

  const handleAltTogglePreview = async () => {
    try {
      if (altIsPreviewOpen) {
        await invoke("close_broadcast_window", { outputId: "alt" })
        setAltIsPreviewOpen(await reconcilePreviewState("alt"))
      } else {
        await invoke("open_broadcast_window", {
          outputId: "alt",
          monitorIndex: Number(altSelectedMonitor),
        })
        const opened = await reconcilePreviewState("alt")
        setAltIsPreviewOpen(opened)
        if (!opened) return
        useBroadcastStore.getState().syncBroadcastOutputFor("alt")
        syncNdiConfigToOutput("alt", altNdiActive, altNdiFrameRate, altNdiResolution)
        setTimeout(() => {
          useBroadcastStore.getState().syncBroadcastOutputFor("alt")
        }, 150)
      }
    } catch (error) {
      console.error("Failed to toggle alt preview window", error)
      toast.error("Could not toggle alt preview window", { description: String(error) })
    }
  }

  const handleAltToggleNdi = async () => {
    try {
      if (altNdiActive) {
        await invoke("stop_ndi", { outputId: "alt" })
        syncNdiConfigToOutput("alt", false, altNdiFrameRate, altNdiResolution)
        setAltNdiActive(false)
        if (!altIsPreviewOpen) {
          await invoke("close_broadcast_window", { outputId: "alt" }).catch(() => {})
        }
      } else {
        await invoke("ensure_broadcast_window", { outputId: "alt" })
        const request: NdiStartRequest = {
          sourceName: altNdiSourceName,
          resolution: altNdiResolution,
          frameRate: altNdiFrameRate,
          alphaMode: altNdiAlphaMode,
        }
        const session = await invoke<NdiSessionInfo>("start_ndi", { outputId: "alt", request })
        setAltNdiActive(true)
        useBroadcastStore.getState().syncBroadcastOutputFor("alt")
        void emitTo("broadcast-alt", "broadcast:ndi-config", {
          active: true,
          fps: session.fps,
          width: session.width,
          height: session.height,
        }).catch(() => {})
        setTimeout(() => {
          useBroadcastStore.getState().syncBroadcastOutputFor("alt")
          syncNdiConfigToOutput("alt", true, altNdiFrameRate, altNdiResolution)
        }, 300)
      }
    } catch (error) {
      console.error("Failed to toggle alt NDI", error)
      toast.error(altNdiActive ? "Could not stop alt NDI" : "Could not start alt NDI", {
        description: String(error),
      })
    }
  }

  const handleAltToggle = async (enabled: boolean) => {
    setAltEnabled(enabled)
    if (!enabled) {
      if (altIsPreviewOpen) {
        await invoke("close_broadcast_window", { outputId: "alt" }).catch(() => {})
        setAltIsPreviewOpen(false)
      }
      if (altNdiActive) {
        await invoke("stop_ndi", { outputId: "alt" }).catch(() => {})
        syncNdiConfigToOutput("alt", false, altNdiFrameRate, altNdiResolution)
        setAltNdiActive(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[700px] gap-4"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle>Broadcast</DialogTitle>
          <DialogDescription>
            Configure two independent outputs with different themes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {/* ── Main Output Card ── */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            {/* Card header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MonitorIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Main Output</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs",
                    mainEnabled ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {mainEnabled ? "On" : "Off"}
                </span>
                <Switch
                  checked={mainEnabled}
                  onCheckedChange={handleMainToggle}
                />
              </div>
            </div>

            {/* Theme selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Theme</label>
              <Select
                value={mainThemeId}
                onValueChange={handleMainThemeChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Output type toggle */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Output Type
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setOutputType("display")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all",
                    outputType === "display"
                      ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MonitorIcon className="size-3.5" />
                  External Display
                </button>
                <button
                  onClick={() => setOutputType("ndi")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all",
                    outputType === "ndi"
                      ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <RadioIcon className="size-3.5" />
                  NDI
                </button>
              </div>
            </div>

            {/* Output-type-specific controls */}
            {outputType === "display" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">
                      Target Monitor
                    </label>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={refreshing}
                      onClick={fetchMonitors}
                      className="h-5 gap-1 px-1.5 text-[0.625rem] text-muted-foreground"
                    >
                      <RefreshCwIcon
                        className={cn(
                          "size-3",
                          refreshing && "animate-spin"
                        )}
                      />
                      Refresh
                    </Button>
                  </div>
                  <Select
                    value={selectedMonitor}
                    onValueChange={setSelectedMonitor}
                    disabled={monitors.length === 0}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={monitors.length === 0}
                    >
                      <SelectValue
                        placeholder={
                          monitors.length === 0
                            ? "No monitors detected"
                            : "Select monitor"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {monitors.map((m, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {m.name} ({m.size.width}&times;{m.size.height})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={monitors.length === 0}
                  onClick={handleTogglePreview}
                >
                  {isPreviewOpen ? (
                    <>
                      <EyeOffIcon className="size-3.5" />
                      Close Preview
                    </>
                  ) : (
                    <>
                      <EyeIcon className="size-3.5" />
                      Open Preview
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Resolution</label>
                    <Select
                      value={ndiResolution}
                      onValueChange={(value) => setNdiResolution(value as NdiResolution)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_RESOLUTION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Frame Rate</label>
                    <Select
                      value={ndiFrameRate}
                      onValueChange={(value) => setNdiFrameRate(value as NdiFrameRate)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_FRAME_RATE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Alpha Channel</label>
                  <Select
                    value={ndiAlphaMode}
                    onValueChange={(value) => setNdiAlphaMode(value as NdiAlphaMode)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NDI_ALPHA_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Source Name</label>
                  <Input
                    value={ndiSourceName}
                    onChange={(e) => setNdiSourceName(e.target.value)}
                    placeholder="Rhema Output"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "w-full gap-1.5",
                    ndiActive &&
                    "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-400"
                  )}
                  onClick={handleToggleNdi}
                >
                  {ndiActive ? (
                    <>
                      <CastIcon className="size-3.5" />
                      Stop NDI
                    </>
                  ) : (
                    <>
                      <CastIcon className="size-3.5" />
                      Start NDI
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* ── Alternate Output Card ── */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CastIcon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Alternate Output</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-xs", altEnabled ? "text-foreground" : "text-muted-foreground")}>
                  {altEnabled ? "On" : "Off"}
                </span>
                <Switch checked={altEnabled} onCheckedChange={handleAltToggle} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Theme</label>
              <Select value={altThemeId} onValueChange={handleAltThemeChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Output Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setAltOutputType("display")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all",
                    altOutputType === "display"
                      ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MonitorIcon className="size-3.5" />
                  External Display
                </button>
                <button
                  onClick={() => setAltOutputType("ndi")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all",
                    altOutputType === "ndi"
                      ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <RadioIcon className="size-3.5" />
                  NDI
                </button>
              </div>
            </div>

            {altOutputType === "display" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Target Monitor</label>
                    <Button variant="ghost" size="xs" disabled={refreshing} onClick={fetchMonitors} className="h-5 gap-1 px-1.5 text-[0.625rem] text-muted-foreground">
                      <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
                      Refresh
                    </Button>
                  </div>
                  <Select value={altSelectedMonitor} onValueChange={setAltSelectedMonitor} disabled={monitors.length === 0}>
                    <SelectTrigger className="w-full" disabled={monitors.length === 0}>
                      <SelectValue placeholder={monitors.length === 0 ? "No monitors detected" : "Select monitor"} />
                    </SelectTrigger>
                    <SelectContent>
                      {monitors.map((m, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {m.name} ({m.size.width}&times;{m.size.height})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-1.5" disabled={monitors.length === 0} onClick={handleAltTogglePreview}>
                  {altIsPreviewOpen ? (<><EyeOffIcon className="size-3.5" />Close Preview</>) : (<><EyeIcon className="size-3.5" />Open Preview</>)}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Resolution</label>
                    <Select value={altNdiResolution} onValueChange={(v) => setAltNdiResolution(v as NdiResolution)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NDI_RESOLUTION_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Frame Rate</label>
                    <Select value={altNdiFrameRate} onValueChange={(v) => setAltNdiFrameRate(v as NdiFrameRate)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NDI_FRAME_RATE_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Alpha Channel</label>
                  <Select value={altNdiAlphaMode} onValueChange={(v) => setAltNdiAlphaMode(v as NdiAlphaMode)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NDI_ALPHA_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Source Name</label>
                  <Input value={altNdiSourceName} onChange={(e) => setAltNdiSourceName(e.target.value)} placeholder="Rhema Alt" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("w-full gap-1.5", altNdiActive && "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-400")}
                  onClick={handleAltToggleNdi}
                >
                  {altNdiActive ? (<><CastIcon className="size-3.5" />Stop NDI</>) : (<><CastIcon className="size-3.5" />Start NDI</>)}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
