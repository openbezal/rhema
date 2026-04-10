import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"

import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { useSettingsStore } from "@/stores"
import type { DeviceInfo } from "@/types/audio"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection = "audio" | "bible" | "display" | "transcription"

const navItems: { name: string; id: NavSection; icon: React.ReactNode }[] = [
  {
    name: "Audio",
    id: "audio",
    icon: <MicIcon strokeWidth={2} />,
  },
  {
    name: "Bible",
    id: "bible",
    icon: <BookOpenIcon strokeWidth={2} />,
  },
  {
    name: "Display Mode",
    id: "display",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Transcription",
    id: "transcription",
    icon: <KeyIcon strokeWidth={2} />,
  },
]

/* -------------------------------------------------------------------------- */
/*  Section: Audio                                                            */
/* -------------------------------------------------------------------------- */

function AudioSection() {
  const {
    audioDeviceId,
    setAudioDeviceId,
    gain,
    setGain,
  } = useSettingsStore()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true)
      const result = await invoke<DeviceInfo[]>("get_audio_devices")
      setDevices(result)
    } catch {
      // Tauri command may not be available during dev
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  // gain is 0.0-2.0 in store, display as 0-100%
  const gainPercent = Math.round((gain / 2.0) * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Device selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Input Device
        </label>
        <Select
          value={audioDeviceId ?? "__default__"}
          onValueChange={(v) => setAudioDeviceId(v === "__default__" ? null : v)}
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

      {/* Input gain */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Input Gain
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
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
/*  Section: Display Mode                                                     */
/* -------------------------------------------------------------------------- */

function DisplayModeSection() {
  const {
    autoMode,
    setAutoMode,
    confidenceThreshold,
    setConfidenceThreshold,
  } = useSettingsStore()

  const thresholdPercent = Math.round(confidenceThreshold * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Broadcast Mode
        </label>

        <RadioGroup
          value={autoMode ? "auto" : "manual"}
          onValueChange={(v) => setAutoMode(v === "auto")}
          className="gap-3"
        >
          {/* Auto mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              !autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Automatically displays the highest-confidence detected verse on
                broadcast output. A 2.5-second cooldown prevents rapid flickering.
                Best for hands-off operation.
              </p>
            </div>
          </label>

          {/* Manual mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Manual</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Nothing goes to broadcast until you explicitly send it. Detected
                verses still appear in the AI Detections panel and queue, but you
                decide which ones to display and when. Best for important services.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* Confidence threshold — only when auto */}
      {autoMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Confidence Threshold
            </label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {thresholdPercent}%
            </span>
          </div>
          <Slider
            min={35}
            max={100}
            step={1}
            value={[thresholdPercent]}
            onValueChange={([v]) => setConfidenceThreshold(v / 100)}
          />
          <p className="text-[0.625rem] text-muted-foreground">
            Only verses with confidence above this threshold will be sent to
            broadcast automatically. Higher values reduce false positives.
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Transcription                                                    */
/* -------------------------------------------------------------------------- */

interface LocalModelStatus {
  model_name: string
  model_path: string | null
  exists: boolean
  size_bytes: number | null
  note: string
}

interface TranscriptionStatus {
  backend: "auto" | "local" | "deepgram"
  recommended_backend: "auto" | "local" | "deepgram"
  local_model: LocalModelStatus
  deepgram_key_configured: boolean
}

function TranscriptionSection() {
  const {
    deepgramApiKey,
    setDeepgramApiKey,
    transcriptionBackend,
    setTranscriptionBackend,
  } = useSettingsStore()
  const [keyValue, setKeyValue] = useState(deepgramApiKey ?? "")
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState<TranscriptionStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  useEffect(() => {
    async function loadStatus() {
      try {
        const result = await invoke<TranscriptionStatus>("get_transcription_status")
        setStatus(result)
      } catch (e) {
        console.error("Failed to load transcription status:", e)
      } finally {
        setLoadingStatus(false)
      }
    }

    loadStatus()
  }, [])

  const handleSave = () => {
    setDeepgramApiKey(keyValue || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const modelReady = status?.local_model.exists ?? false

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Local Whisper.cpp Model
          </label>
          {modelReady ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Ready
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem]">
              Missing
            </Badge>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-[0.625rem] leading-relaxed text-muted-foreground">
          {loadingStatus ? (
            "Checking local model..."
          ) : status?.local_model.exists ? (
            <>
              <div className="text-foreground">
                {status.local_model.model_name}
              </div>
              <div className="mt-1 break-all">
                {status.local_model.model_path}
              </div>
            </>
          ) : (
            <div>{status?.local_model.note ?? "Local model not found."}</div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Transcription Source
        </label>

        <RadioGroup
          value={transcriptionBackend}
          onValueChange={(v) => setTranscriptionBackend(v as "auto" | "local" | "deepgram")}
          className="gap-3"
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20">
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">Auto</span>
                <Badge variant="outline" className="text-[0.5rem]">
                  Recommended
                </Badge>
              </div>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Prefer local Whisper.cpp whenever the model is available, and
                fall back to Deepgram only if a key is configured and the local
                setup is missing.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20">
            <RadioGroupItem value="local" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Local only</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Always use the on-device Whisper.cpp model and never fall back
                to cloud transcription.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20">
            <RadioGroupItem value="deepgram" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Deepgram only</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Use the cloud backend explicitly. This requires a configured API
                key.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Deepgram Fallback Key
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
          <Button size="sm" onClick={handleSave}>
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
          Optional fallback when local Whisper.cpp is unavailable, or required
          if you select Deepgram only.
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
  display: "Display Mode",
  transcription: "Transcription",
}

/* -------------------------------------------------------------------------- */
/*  Section: Bible Translation                                                */
/* -------------------------------------------------------------------------- */

interface TranslationInfo {
  id: number
  abbreviation: string
  title: string
  language: string
}

function BibleSection() {
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
      await invoke("set_active_translation", { translationId: id })
      setActiveId(id)
      // Update frontend stores so all panels use the new translation
      const { useBibleStore } = await import("@/stores")
      useBibleStore.getState().setActiveTranslation(id)
    } catch (e) {
      console.error("Failed to set translation:", e)
    }
  }

  const englishTranslations = translations.filter((t) => t.language === "en")
  const otherTranslations = translations.filter((t) => t.language !== "en")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Primary Translation
        </label>
        <Select
          value={String(activeId)}
          onValueChange={handleChange}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loading ? "Loading..." : "Select translation"} />
          </SelectTrigger>
          <SelectContent>
            {englishTranslations.length > 0 && (
              <>
                <div className="px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
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
                <div className="mt-1 px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
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
          {translations.length > 0 && ` ${translations.length} translations available.`}
        </p>
      </div>
    </div>
  )
}

const sectionComponents: Record<NavSection, React.FC> = {
  audio: AudioSection,
  bible: BibleSection,
  display: DisplayModeSection,
  transcription: TranscriptionSection,
}

/* -------------------------------------------------------------------------- */
/*  Main dialog                                                               */
/* -------------------------------------------------------------------------- */

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<NavSection>("audio")

  const ActiveContent = sectionComponents[activeSection]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <SettingsIcon className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure audio, display mode, Bible translation, and transcription.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <div className="h-14 border-b border-border border-r px-4 flex items-center" >
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
