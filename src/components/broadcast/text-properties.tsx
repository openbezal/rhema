import { useEffect, useState } from "react"
import { ChevronsUpDownIcon, CheckIcon } from "lucide-react"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { SurfaceControls } from "@/components/broadcast/surface-properties"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { parseColorOpacity, buildColorWithOpacity } from "@/lib/color-utils"
import { listAllFonts } from "@/lib/fonts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function FontFamilyPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (font: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [fonts, setFonts] = useState<{ bundled: string[]; system: string[] }>({
    bundled: [],
    system: [],
  })

  useEffect(() => {
    let cancelled = false
    void listAllFonts().then((result) => {
      if (!cancelled) setFonts(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const renderItem = (font: string) => (
    <CommandItem
      key={font}
      value={font}
      onSelect={() => {
        onChange(font)
        setOpen(false)
      }}
    >
      <CheckIcon
        className={`size-3.5 ${font === value ? "opacity-100" : "opacity-0"}`}
      />
      <span style={{ fontFamily: `"${font}"` }}>{font}</span>
    </CommandItem>
  )

  return (
    // modal: the designer lives in a Radix Dialog whose scroll lock swallows
    // wheel events in portaled popover content — modal popovers manage their
    // own lock, restoring wheel scrolling in the font list.
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate" style={{ fontFamily: `"${value}"` }}>
            {value}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fonts…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No font found.</CommandEmpty>
            <CommandGroup heading="Bundled">
              {fonts.bundled.map(renderItem)}
            </CommandGroup>
            {fonts.system.length > 0 && (
              <CommandGroup heading="System">
                {fonts.system.map(renderItem)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const FONT_WEIGHTS = [
  { value: "100", label: "100 - Thin" },
  { value: "200", label: "200 - Extra Light" },
  { value: "300", label: "300 - Light" },
  { value: "400", label: "400 - Regular" },
  { value: "500", label: "500 - Medium" },
  { value: "600", label: "600 - Semi Bold" },
  { value: "700", label: "700 - Bold" },
  { value: "800", label: "800 - Extra Bold" },
  { value: "900", label: "900 - Black" },
]

const HORIZONTAL_ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
] as const

const VERTICAL_ALIGN_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
] as const

const TEXT_TRANSFORM_OPTIONS = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "Uppercase" },
  { value: "lowercase", label: "Lowercase" },
  { value: "capitalize", label: "Capitalize" },
] as const

const TEXT_DECORATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "underline", label: "Underline" },
  { value: "line-through", label: "Line Through" },
] as const

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-0.5 pb-1">
      <h4 className="text-xs font-semibold">{title}</h4>
      <p className="text-[11px] text-muted-foreground">{description}</p>
    </div>
  )
}

function FontControls({ prefix }: { prefix: "verseText" | "reference" }) {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  const data = prefix === "verseText" ? draftTheme.verseText : draftTheme.reference
  const { hex: colorHex, opacity: colorOpacity } = parseColorOpacity(data.color)
  const horizontalAlign = data.horizontalAlign ?? draftTheme.layout.textAlign
  const verticalAlign = data.verticalAlign ?? "top"
  const textTransform = data.textTransform ?? "none"
  const textDecoration = data.textDecoration ?? "none"

  return (
    <div className="flex flex-col gap-3">
      {/* Font Family */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Font Family</label>
        <FontFamilyPicker
          value={data.fontFamily}
          onChange={(v) => update(`${prefix}.fontFamily`, v)}
        />
      </div>

      {/* Font Weight */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Font Weight</label>
        <Select
          value={String(data.fontWeight)}
          onValueChange={(v) => update(`${prefix}.fontWeight`, Number(v))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_WEIGHTS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Font Size */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Font Size</label>
          <span className="text-xs tabular-nums text-muted-foreground">{data.fontSize}px</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            min={8}
            max={200}
            step={1}
            value={[data.fontSize]}
            onValueChange={([v]) => update(`${prefix}.fontSize`, v)}
            className="flex-1"
          />
          <Input
            type="number"
            min={8}
            max={200}
            value={data.fontSize}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 8 && v <= 200) update(`${prefix}.fontSize`, v)
            }}
            className="w-16"
          />
        </div>
      </div>

      {/* Line Height — only for verse text, reference type doesn't have lineHeight */}
      {prefix === "verseText" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Line Height</label>
            <span className="text-xs tabular-nums text-muted-foreground">{(draftTheme.verseText.lineHeight).toFixed(2)}</span>
          </div>
          <Slider
            min={0.5}
            max={3.0}
            step={0.05}
            value={[draftTheme.verseText.lineHeight]}
            onValueChange={([v]) => update("verseText.lineHeight", v)}
          />
        </div>
      )}

      {/* Letter Spacing */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Letter Spacing</label>
          <span className="text-xs tabular-nums text-muted-foreground">{data.letterSpacing}px</span>
        </div>
        <Slider
          min={-5}
          max={50}
          step={0.5}
          value={[data.letterSpacing]}
          onValueChange={([v]) => update(`${prefix}.letterSpacing`, v)}
        />
      </div>

      {/* Horizontal Alignment */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Horizontal Alignment</label>
        <Select
          value={horizontalAlign}
          onValueChange={(v) => update(`${prefix}.horizontalAlign`, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZONTAL_ALIGN_OPTIONS
              .filter((option) => prefix === "verseText" || option.value !== "justify")
              .map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {/* Vertical Alignment */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Vertical Alignment</label>
        <Select
          value={verticalAlign}
          onValueChange={(v) => update(`${prefix}.verticalAlign`, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERTICAL_ALIGN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Text Transform */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Text Transform</label>
        <Select
          value={textTransform}
          onValueChange={(v) => update(`${prefix}.textTransform`, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEXT_TRANSFORM_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Text Decoration */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Text Decoration</label>
        <Select
          value={textDecoration}
          onValueChange={(v) => update(`${prefix}.textDecoration`, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEXT_DECORATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Text Color */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Text Color</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={colorHex}
            onChange={(e) =>
              update(`${prefix}.color`, buildColorWithOpacity(e.target.value, colorOpacity))
            }
            className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
          />
          <Input
            value={colorHex}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                update(`${prefix}.color`, buildColorWithOpacity(v, colorOpacity))
              }
            }}
            className="w-20 font-mono"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Opacity</label>
          <span className="text-xs tabular-nums text-muted-foreground">{colorOpacity}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[colorOpacity]}
          onValueChange={([v]) =>
            update(`${prefix}.color`, buildColorWithOpacity(colorHex, v))
          }
        />
      </div>
    </div>
  )
}

function ReferenceProperties() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader title="Reference Text" description="Customize how reference text appears" />
      <FontControls prefix="reference" />

      {/* Uppercase */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Uppercase</label>
        <input
          type="checkbox"
          checked={draftTheme.reference.uppercase}
          onChange={(e) => update("reference.uppercase", e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
      </div>

      <SurfaceControls
        prefix="reference.surface"
        title="Reference Plate"
        description="A chip behind the reference alone"
      />

      {/* Reference Position (stacked mode only — free mode positions by box) */}
      {draftTheme.layout.mode !== "free" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Reference Position</label>
          <Select
            value={draftTheme.reference.position}
            onValueChange={(v) => update("reference.position", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="above">Above Verse</SelectItem>
              <SelectItem value="below">Below Verse</SelectItem>
              <SelectItem value="inline">Inline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

function VerseProperties() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  const shadow = draftTheme.verseText.shadow
  const outline = draftTheme.verseText.outline

  const shadowColor = shadow ? parseColorOpacity(shadow.color) : { hex: "#000000", opacity: 100 }
  const outlineColor = outline ? parseColorOpacity(outline.color) : { hex: "#000000", opacity: 100 }

  const verseNumbers = draftTheme.verseNumbers
  const verseNumberColor = parseColorOpacity(verseNumbers.color)
  const superscriptSizePct = Math.round(
    (verseNumbers.fontSize / draftTheme.verseText.fontSize) * 100
  )

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader title="Verse Text" description="Customize how verse text appears" />
      <FontControls prefix="verseText" />

      {/* Verse Numbers */}
      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">Verse Numbers</label>
          <input
            type="checkbox"
            checked={verseNumbers.visible}
            onChange={(e) => update("verseNumbers.visible", e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
        </div>

        {verseNumbers.visible && (
          <div className="flex flex-col gap-3">
            {/* Superscript */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Superscript</label>
              <input
                type="checkbox"
                checked={verseNumbers.superscript}
                onChange={(e) => update("verseNumbers.superscript", e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
            </div>

            {/* Superscript Size */}
            {verseNumbers.superscript && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Size</label>
                  <span className="text-xs tabular-nums text-muted-foreground">{superscriptSizePct}%</span>
                </div>
                <Slider
                  min={20}
                  max={100}
                  step={1}
                  value={[superscriptSizePct]}
                  onValueChange={([v]) => {
                    const newFontSize = Math.round((v / 100) * draftTheme.verseText.fontSize)
                    update("verseNumbers.fontSize", newFontSize)
                  }}
                />
              </div>
            )}

            {/* Number Color */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Number Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={verseNumberColor.hex}
                  onChange={(e) =>
                    update(
                      "verseNumbers.color",
                      buildColorWithOpacity(e.target.value, verseNumberColor.opacity)
                    )
                  }
                  className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <Input
                  value={verseNumberColor.hex}
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                      update(
                        "verseNumbers.color",
                        buildColorWithOpacity(v, verseNumberColor.opacity)
                      )
                    }
                  }}
                  className="w-20 font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Opacity</label>
                <span className="text-xs tabular-nums text-muted-foreground">{verseNumberColor.opacity}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[verseNumberColor.opacity]}
                onValueChange={([v]) =>
                  update("verseNumbers.color", buildColorWithOpacity(verseNumberColor.hex, v))
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Text Shadow */}
      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">Text Shadow</label>
          <input
            type="checkbox"
            checked={shadow !== null}
            onChange={(e) => {
              if (e.target.checked) {
                update("verseText.shadow", { color: "#00000080", blur: 4, x: 2, y: 2 })
              } else {
                update("verseText.shadow", null)
              }
            }}
            className="h-4 w-4 rounded border-input accent-primary"
          />
        </div>

        {shadow && (
          <div className="flex flex-col gap-3">
            {/* Offset X */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Offset X</label>
                <span className="text-xs tabular-nums text-muted-foreground">{shadow.x}px</span>
              </div>
              <Slider
                min={-20}
                max={50}
                step={1}
                value={[shadow.x]}
                onValueChange={([v]) => update("verseText.shadow.x", v)}
              />
            </div>

            {/* Offset Y */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Offset Y</label>
                <span className="text-xs tabular-nums text-muted-foreground">{shadow.y}px</span>
              </div>
              <Slider
                min={-20}
                max={50}
                step={1}
                value={[shadow.y]}
                onValueChange={([v]) => update("verseText.shadow.y", v)}
              />
            </div>

            {/* Blur */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Blur</label>
                <span className="text-xs tabular-nums text-muted-foreground">{shadow.blur}px</span>
              </div>
              <Slider
                min={0}
                max={50}
                step={1}
                value={[shadow.blur]}
                onValueChange={([v]) => update("verseText.shadow.blur", v)}
              />
            </div>

            {/* Shadow Color */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Shadow Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={shadowColor.hex}
                  onChange={(e) =>
                    update(
                      "verseText.shadow.color",
                      buildColorWithOpacity(e.target.value, shadowColor.opacity)
                    )
                  }
                  className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <Input
                  value={shadowColor.hex}
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                      update(
                        "verseText.shadow.color",
                        buildColorWithOpacity(v, shadowColor.opacity)
                      )
                    }
                  }}
                  className="w-20 font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Opacity</label>
                <span className="text-xs tabular-nums text-muted-foreground">{shadowColor.opacity}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[shadowColor.opacity]}
                onValueChange={([v]) =>
                  update(
                    "verseText.shadow.color",
                    buildColorWithOpacity(shadowColor.hex, v)
                  )
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Text Outline */}
      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">Text Outline</label>
          <input
            type="checkbox"
            checked={outline !== null}
            onChange={(e) => {
              if (e.target.checked) {
                update("verseText.outline", { color: "#000000", width: 1 })
              } else {
                update("verseText.outline", null)
              }
            }}
            className="h-4 w-4 rounded border-input accent-primary"
          />
        </div>

        {outline && (
          <div className="flex flex-col gap-3">
            {/* Width */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Width</label>
                <span className="text-xs tabular-nums text-muted-foreground">{outline.width}px</span>
              </div>
              <Slider
                min={0}
                max={20}
                step={0.5}
                value={[outline.width]}
                onValueChange={([v]) => update("verseText.outline.width", v)}
              />
            </div>

            {/* Outline Color */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Outline Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={outlineColor.hex}
                  onChange={(e) => update("verseText.outline.color", e.target.value)}
                  className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <Input
                  value={outlineColor.hex}
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                      update("verseText.outline.color", v)
                    }
                  }}
                  className="w-20 font-mono"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <SurfaceControls
        prefix="verseText.surface"
        title="Verse Plate"
        description="A plate behind the verse text alone"
      />
    </div>
  )
}

export function TextProperties() {
  const selectedElement = useBroadcastStore((s) => s.selectedElement)

  if (selectedElement === "reference") {
    return <ReferenceProperties />
  }

  if (selectedElement === "verse") {
    return <VerseProperties />
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">No element selected</p>
      <p className="text-xs text-muted-foreground">
        Click on verse, reference, or translation text in the canvas to edit its properties
      </p>
    </div>
  )
}
