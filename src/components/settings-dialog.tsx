import { setRemoteServerRunning } from "@/lib/operator-palette"
import { operatorActions } from "@/lib/operator-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"

import { Button } from "@/components/ui/button"
import { BibleDataNotices } from "@/components/bible-data-notices"
import { BookDisplayNamesEditor } from "@/components/settings/book-display-names"
import type { Translation } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { DiagnosticsSection } from "@/components/settings/diagnostics-section"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  MicIcon,
  TvIcon,
  KeyIcon,
  SettingsIcon,
  CheckIcon,
  BookOpenIcon,
  RadioIcon,
  FileTextIcon,
  HelpCircleIcon,
  GraduationCapIcon,
  BrainCircuitIcon,
} from "lucide-react"
import { LevelMeter } from "@/components/ui/level-meter"
import { useAudioTest } from "@/hooks/use-audio-test"
import { useSettingsStore } from "@/stores"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import type { DeviceInfo } from "@/types/audio"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection =
  | "audio"
  | "speech"
  | "bible"
  | "display"
  | "detections"
  | "api-keys"
  | "remote"
  | "diagnostics"
  | "help"

const navItems: { name: string; id: NavSection; icon: React.ReactNode }[] = [
  {
    name: "Audio",
    id: "audio",
    icon: <MicIcon strokeWidth={2} />,
  },
  {
    name: "Speech Recognition",
    id: "speech",
    icon: <BrainCircuitIcon strokeWidth={2} />,
  },
  {
    name: "Bible",
    id: "bible",
    icon: <BookOpenIcon strokeWidth={2} />,
  },
  {
    name: "Detections",
    id: "detections",
    icon: <BrainCircuitIcon strokeWidth={2} />,
  },
  {
    name: "Display Mode",
    id: "display",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Remote Control",
    id: "remote",
    icon: <RadioIcon strokeWidth={2} />,
  },
  {
    name: "API Keys",
    id: "api-keys",
    icon: <KeyIcon strokeWidth={2} />,
  },
  {
    name: "Diagnostics",
    id: "diagnostics",
    icon: <FileTextIcon strokeWidth={2} />,
  },
  {
    name: "Help",
    id: "help",
    icon: <HelpCircleIcon strokeWidth={2} />,
  },
]

/* -------------------------------------------------------------------------- */
/*  Section: Audio                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Isolated leaf so the ~15 Hz `audio_level` ticks during a test re-render
 * only this row, not the whole settings dialog (same pattern as the
 * transcript panel's meter).
 */
function AudioTestRow() {
  const { isTesting, level, toggle } = useAudioTest()
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Test Input
      </label>
      <div className="flex items-center gap-3">
        <LevelMeter level={level} bars={6} className="h-5 flex-1" />
        <Button
          size="sm"
          variant={isTesting ? "destructive" : "outline"}
          disabled={isTranscribing}
          onClick={() => void toggle()}
        >
          {isTesting ? "Stop" : "Test"}
        </Button>
      </div>
      <p className="text-[0.625rem] text-muted-foreground">
        {isTranscribing
          ? "Testing is unavailable while transcription is running."
          : "Captures from the selected device to verify it works. Gain changes apply on the next test. Stops automatically after 60 seconds."}
      </p>
    </div>
  )
}

function AudioSection() {
  const { audioDeviceId, setAudioDeviceId, gain, setGain } = useSettingsStore()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadDevices = useCallback(
    () =>
      invoke<DeviceInfo[]>("get_audio_devices")
        .then(setDevices)
        .catch(() => setDevices([]))
        .finally(() => setLoading(false)),
    []
  )

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  // gain is 0.0-2.0 in store, display as 0-100%
  const gainPercent = Math.round((gain / 2.0) * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Device selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Input Device
        </label>
        <Select
          value={audioDeviceId ?? "__default__"}
          onValueChange={(v) =>
            setAudioDeviceId(v === "__default__" ? null : v)
          }
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue
              placeholder={loading ? "Loading devices..." : "System default"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">System default</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
                {device.is_default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Selected device persists across sessions. Leave as system default to
          follow OS audio routing.
        </p>
      </div>

      {/* Test input */}
      <AudioTestRow />

      {/* Input gain */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Input Gain
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {gainPercent}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[gainPercent]}
          onValueChange={([v]) => setGain((v / 100) * 2.0)}
        />
        <p className="text-[0.625rem] text-muted-foreground">
          Amplifies the incoming audio signal before transcription. 50% is unity
          gain.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Speech Recognition                                               */
/* -------------------------------------------------------------------------- */

function SpeechSection() {
  const { sttProvider, setSttProvider, deepgramApiKey, setDeepgramApiKey } =
    useSettingsStore()

  const [keyValue, setKeyValue] = useState(deepgramApiKey ?? "")
  const [saved, setSaved] = useState(false)

  const handleSaveKey = () => {
    setDeepgramApiKey(keyValue || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Provider selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Provider
        </label>

        <RadioGroup
          value={sttProvider}
          onValueChange={(v) => setSttProvider(v as "deepgram" | "whisper")}
          className="gap-3"
        >
          {/* Deepgram (cloud) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "deepgram"
                ? "hover:border-muted-foreground/25"
                : ""
            }`}
          >
            <RadioGroupItem value="deepgram" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Cloud (Deepgram)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Uses Deepgram Nova-3 for real-time streaming transcription.
                Requires an API key and internet connection. Best accuracy with
                keyword boosting for Bible terms.
              </p>
            </div>
          </label>

          {/* Whisper (local) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "whisper"
                ? "hover:border-muted-foreground/25"
                : ""
            }`}
          >
            <RadioGroupItem value="whisper" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Local (Whisper)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Runs Whisper large-v3-turbo locally on your device. Fully
                offline, no API key needed. Audio never leaves your machine.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* Deepgram settings — show when deepgram is selected */}
      {sttProvider === "deepgram" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Deepgram API Key
            </label>
            {deepgramApiKey && (
              <Badge variant="outline" className="text-[0.5rem]">
                Key configured
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Enter your Deepgram API key..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className="flex-1 text-xs"
            />
            <Button size="sm" onClick={handleSaveKey}>
              {saved ? (
                <>
                  <CheckIcon className="size-3" />
                  Saved
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-[0.625rem] text-muted-foreground">
            Required for live transcription. Get a key at{" "}
            <span className="text-primary">deepgram.com</span>
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Display Mode                                                     */
/* -------------------------------------------------------------------------- */

function DisplayModeSection() {
  const autoLive = useBroadcastStore((s) => s.autoLive)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Broadcast Mode
        </label>

        <RadioGroup
          value={autoLive ? "auto" : "manual"}
          onValueChange={(v) => operatorActions.setAutoLive(v === "auto")}
          className="gap-3"
        >
          {/* Auto mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              !autoLive ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Automatically displays the highest-confidence detected verse on
                broadcast output. Follow in Book search independently controls
                whether detections move your browsing position.
              </p>
            </div>
          </label>

          {/* Manual mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              autoLive ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Manual
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Nothing goes to broadcast until you explicitly send it. Detected
                verses still appear in the AI Detections panel and queue, but
                you decide which ones to display and when. Best for important
                services.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: API Keys                                                         */
/* -------------------------------------------------------------------------- */

function DetectionSection() {
  const capacity = useSettingsStore((state) => state.suggestionCapacity)
  const retention = useSettingsStore((state) => state.suggestionRetentionMs)
  return (
    <div className="flex max-w-lg flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Suggestions keep recent quotation matches. New arrivals wait for Apply
        updates while the list you inspect stays stable.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        Maximum suggestions
        <Input
          aria-label="Maximum suggestions"
          type="number"
          min={1}
          max={100}
          value={capacity}
          onChange={(event) =>
            useSettingsStore
              .getState()
              .setSuggestionCapacity(Number(event.target.value))
          }
        />
        <span className="text-xs text-muted-foreground">
          Keep 1–100 candidates. Default: 25.
        </span>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        Retain suggestions for seconds
        <Input
          aria-label="Retain suggestions for seconds"
          type="number"
          min={1}
          max={300}
          value={retention / 1000}
          onChange={(event) =>
            useSettingsStore
              .getState()
              .setSuggestionRetentionMs(Number(event.target.value) * 1000)
          }
        />
        <span className="text-xs text-muted-foreground">
          Keep recent matches for 1–300 seconds. Default: 60. An inspected card
          stays until interaction ends.
        </span>
      </label>
    </div>
  )
}

function ApiKeysSection() {
  const { deepgramApiKey, sttProvider } = useSettingsStore()

  return (
    <div className="flex flex-col gap-6">
      {/* Deepgram key status (configured in Speech Recognition section) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Deepgram API Key
          </label>
          {deepgramApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Key configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[0.5rem] text-muted-foreground"
            >
              Not set
            </Badge>
          )}
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          {sttProvider === "whisper"
            ? "Not required when using local Whisper. "
            : "Required for cloud transcription. "}
          Configure in the Speech Recognition section.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section titles                                                            */
/* -------------------------------------------------------------------------- */

const sectionTitles: Record<NavSection, string> = {
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Display Mode",
  detections: "Detections and suggestions",
  remote: "Remote Control",
  "api-keys": "API Keys",
  diagnostics: "Diagnostics",
  help: "Help",
}

/* -------------------------------------------------------------------------- */
/*  Section: Bible Translation                                                */
/* -------------------------------------------------------------------------- */

type TranslationInfo = Translation

function BibleSection() {
  const primaryCode = useBibleStore((state) => state.activeTranslationCode)
  const [translations, setTranslations] = useState<TranslationInfo[]>([])
  const [activeId, setActiveId] = useState<number>(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [trans, active] = await Promise.all([
          invoke<TranslationInfo[]>("list_translations"),
          invoke<number>("get_active_translation"),
        ])
        setTranslations(trans)
        setActiveId(active)
      } catch (e) {
        console.error("Failed to load translations:", e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleChange = async (value: string) => {
    const id = parseInt(value)
    try {
      const { activateTranslation } = await import("@/stores/bible-store")
      await activateTranslation(id)
      setActiveId(id)
    } catch (e) {
      console.error("Failed to set translation:", e)
    }
  }

  const englishTranslations = translations.filter((t) => t.language === "en")
  const otherTranslations = translations.filter((t) => t.language !== "en")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Primary Translation
        </label>
        <Select
          value={String(activeId)}
          onValueChange={handleChange}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue
              placeholder={loading ? "Loading..." : "Select translation"}
            />
          </SelectTrigger>
          <SelectContent>
            {englishTranslations.length > 0 && (
              <>
                <div className="px-2 py-1 text-[0.5625rem] font-medium tracking-wider text-muted-foreground uppercase">
                  English
                </div>
                {englishTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
            {otherTranslations.length > 0 && (
              <>
                <div className="mt-1 px-2 py-1 text-[0.5625rem] font-medium tracking-wider text-muted-foreground uppercase">
                  Other Languages
                </div>
                {otherTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Detected verses will display in this translation.
          {translations.length > 0 &&
            ` ${translations.length} translations available.`}
        </p>
      </div>
      <BookDisplayNamesEditor translations={translations} primaryCode={primaryCode} />
      <div><BibleDataNotices /></div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Remote Control                                                   */
/* -------------------------------------------------------------------------- */

interface RemoteStatus {
  running: boolean
  port: number | null
}

interface CommandLogEntry {
  id: number
  timestamp: string
  source: "OSC" | "HTTP"
  command: string
}

function RemoteControlSection() {
  const [oscPort, setOscPort] = useState("8000")
  const [httpPort, setHttpPort] = useState("8080")
  const [oscStatus, setOscStatus] = useState<RemoteStatus>({
    running: false,
    port: null,
  })
  const [httpStatus, setHttpStatus] = useState<RemoteStatus>({
    running: false,
    port: null,
  })
  const [oscError, setOscError] = useState<string | null>(null)
  const [httpError, setHttpError] = useState<string | null>(null)
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([])
  const logIdRef = useRef(0)

  // Poll statuses
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const osc = await invoke<RemoteStatus>("get_osc_status")
        setOscStatus(osc)
        if (osc.running) setOscError(null)
      } catch {
        /* ignore */
      }
      try {
        const http = await invoke<RemoteStatus>("get_http_status")
        setHttpStatus(http)
        if (http.running) setHttpError(null)
      } catch {
        /* ignore */
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Listen for remote commands to populate the log
  useEffect(() => {
    let cancelled = false
    const unlisteners: (() => void)[] = []

    async function setup() {
      const { listen } = await import("@tauri-apps/api/event")

      for (const event of Object.values(REMOTE_EVENTS)) {
        const unlisten = await listen(event, () => {
          if (cancelled) return
          const entry: CommandLogEntry = {
            id: logIdRef.current++,
            timestamp: new Date().toLocaleTimeString(),
            source: "OSC", // We can't distinguish source at event level; default to OSC
            command: event.replace("remote:", ""),
          }
          setCommandLog((prev) => [entry, ...prev].slice(0, 50))
        })
        unlisteners.push(unlisten)
      }
    }

    setup()
    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [])

  const handleOscToggle = async () => {
    try {
      const status = await setRemoteServerRunning(
        "osc",
        !oscStatus.running,
        Number(oscPort)
      )
      setOscStatus(status)
      if (status.port !== null) setOscPort(String(status.port))
      setOscError(null)
    } catch (error) {
      setOscError(String(error))
    }
  }
  const handleHttpToggle = async () => {
    try {
      const status = await setRemoteServerRunning(
        "http",
        !httpStatus.running,
        Number(httpPort)
      )
      setHttpStatus(status)
      if (status.port !== null) setHttpPort(String(status.port))
      setHttpError(null)
    } catch (error) {
      setHttpError(String(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* OSC */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          OSC (Open Sound Control)
        </label>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={oscPort}
              onChange={(e) => setOscPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={oscStatus.running}
            />
          </div>
          <StatusDot running={oscStatus.running} />
          <Button
            size="sm"
            variant={oscStatus.running ? "destructive" : "default"}
            onClick={handleOscToggle}
            className="text-xs"
          >
            {oscStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {oscError && <p className="text-[0.625rem] text-red-500">{oscError}</p>}
        {oscStatus.running && oscStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Listening on UDP port {oscStatus.port}
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          Receives commands from hardware controllers (Stream Deck, TouchOSC,
          Companion) via OSC over UDP.
        </p>
      </div>

      {/* HTTP API */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          HTTP API
        </label>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={httpPort}
              onChange={(e) => setHttpPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={httpStatus.running}
            />
          </div>
          <StatusDot running={httpStatus.running} />
          <Button
            size="sm"
            variant={httpStatus.running ? "destructive" : "default"}
            onClick={handleHttpToggle}
            className="text-xs"
          >
            {httpStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {httpError && (
          <p className="text-[0.625rem] text-red-500">{httpError}</p>
        )}
        {httpStatus.running && httpStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Serving on http://localhost:{httpStatus.port}/api/v1/
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          REST API for status queries and control commands. Use with custom
          dashboards, automation scripts, or HTTP-capable controllers.
        </p>
      </div>

      {/* Firewall guidance */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="mb-1 text-[0.625rem] font-medium text-muted-foreground">
          Firewall Note
        </p>
        <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
          Your OS may block incoming connections. On macOS, allow Rhema through
          System Settings → Network → Firewall. On Windows, allow through
          Windows Security → Firewall → Allow an app.
        </p>
      </div>

      {/* Command Log */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Command Log
          </label>
          {commandLog.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[0.5rem]"
              onClick={() => setCommandLog([])}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
          {commandLog.length === 0 ? (
            <p className="mt-8 text-center text-[0.625rem] text-muted-foreground">
              No commands received yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {commandLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 text-[0.625rem]"
                >
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {entry.timestamp}
                  </span>
                  <Badge variant="outline" className="h-3.5 px-1 text-[0.5rem]">
                    {entry.source}
                  </Badge>
                  <span className="font-mono text-foreground">
                    {entry.command}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Help                                                             */
/* -------------------------------------------------------------------------- */

function HelpSection() {
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Resources to help you get the most out of Rhema.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GraduationCapIcon className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Interactive Tutorial</p>
              <p className="text-xs text-muted-foreground">
                Step-by-step walkthrough of every feature
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              closeSettings()
              setTimeout(() => {
                useTutorialStore.getState().startTutorial()
              }, 300)
            }}
          >
            <GraduationCapIcon className="mr-1.5 size-3.5" />
            Restart
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Keyboard Shortcuts</p>
              <p className="text-xs text-muted-foreground">
                Arrow keys navigate the tutorial, Esc to dismiss
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`size-2 rounded-full ${
          running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/30"
        }`}
      />
      <span className="text-[0.625rem] text-muted-foreground">
        {running ? "Listening" : "Stopped"}
      </span>
    </div>
  )
}

const sectionComponents: Record<NavSection, React.FC> = {
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  detections: DetectionSection,
  remote: RemoteControlSection,
  "api-keys": ApiKeysSection,
  diagnostics: DiagnosticsSection,
  help: HelpSection,
}

/*  Main dialog                                                               */
/* -------------------------------------------------------------------------- */

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.isOpen)
  const activeSection = useSettingsDialogStore((s) => s.activeSection)
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)
  const openSettingsFn = useSettingsDialogStore((s) => s.openSettings)
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  const ActiveContent = sectionComponents[activeSection]

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openSettingsFn()
        } else {
          closeSettings()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" data-tour="settings">
          <SettingsIcon className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure audio, display mode, and API keys.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <div className="flex h-14 items-center border-r border-b border-border px-4">
              Settings
            </div>
            <SidebarContent className="border-r border-border">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeSection}
                          onClick={() => setActiveSection(item.id)}
                        >
                          {item.icon}
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[580px] flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border">
              <div className="flex items-center gap-2 px-4">
                {sectionTitles[activeSection]}
              </div>
            </header>
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
              <ActiveContent />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
