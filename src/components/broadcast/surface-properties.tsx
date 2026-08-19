import { useBroadcastStore } from "@/stores/broadcast-store"
import { pickThemeBackgroundImage } from "@/lib/theme-designer-files"
import { buildColorWithOpacity, parseColorOpacity } from "@/lib/color-utils"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import type { BroadcastTheme, SurfaceFill, ThemeImageFill } from "@/types/broadcast"

/** Dotted path to a SurfaceFill within a theme. */
export type SurfacePrefix = "textBox" | "reference.surface" | "verseText.surface"

const DEFAULT_IMAGE: ThemeImageFill = {
  url: "",
  fit: "cover",
  blur: 0,
  brightness: 100,
  tint: null,
}

const NEW_SURFACE: SurfaceFill = {
  enabled: true,
  color: "#000000",
  opacity: 0.7,
  borderRadius: 12,
  padding: 24,
  image: null,
}

function surfaceAt(
  theme: BroadcastTheme,
  prefix: SurfacePrefix
): SurfaceFill | undefined {
  switch (prefix) {
    case "textBox":
      return theme.textBox
    case "reference.surface":
      return theme.reference.surface
    case "verseText.surface":
      return theme.verseText.surface
  }
}

/**
 * Controls for one surface — the filled container a block of text sits in.
 * Parameterised by dotted prefix so the same panel drives the shared
 * container and each element's own plate.
 */
export function SurfaceControls({
  prefix,
  title,
  description,
}: {
  prefix: SurfacePrefix
  title: string
  description?: string
}) {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  const surface = surfaceAt(draftTheme, prefix)
  const enabled = surface?.enabled ?? false
  const image = surface?.image ?? null
  const { hex: colorHex } = parseColorOpacity(surface?.color ?? "#000000")
  const tint = image?.tint
    ? parseColorOpacity(image.tint)
    : { hex: "#000000", opacity: 50 }

  const toggle = (on: boolean) => {
    // The whole object must be written at once — setNestedValue creates
    // missing intermediates but fills in no defaults.
    if (!surface) {
      update(prefix, { ...NEW_SURFACE, enabled: on })
    } else {
      update(`${prefix}.enabled`, on)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h4 className="text-xs font-semibold">{title}</h4>
          {description && (
            <p className="text-[0.625rem] text-muted-foreground">{description}</p>
          )}
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
          aria-label={`${title} enabled`}
        />
      </div>

      {enabled && surface && (
        <div className="flex flex-col gap-3">
          {/* Fill type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fill</label>
            <Select
              value={image ? "image" : "color"}
              onValueChange={(v) =>
                update(`${prefix}.image`, v === "image" ? { ...DEFAULT_IMAGE } : null)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="color">Solid Color</SelectItem>
                <SelectItem value="image">Image</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {image ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  void (async () => {
                    const dataUrl = await pickThemeBackgroundImage()
                    if (dataUrl) update(`${prefix}.image.url`, dataUrl)
                  })()
                }}
              >
                {image.url ? "Change Image" : "Choose Image"}
              </Button>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Fit</label>
                <Select
                  value={image.fit}
                  onValueChange={(v) => update(`${prefix}.image.fit`, v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                    <SelectItem value="stretch">Stretch</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <SliderRow
                label="Blur"
                suffix="px"
                value={image.blur}
                max={50}
                onChange={(v) => update(`${prefix}.image.blur`, v)}
              />
              <SliderRow
                label="Brightness"
                suffix="%"
                value={image.brightness}
                max={200}
                onChange={(v) => update(`${prefix}.image.brightness`, v)}
              />

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Color Overlay
                </label>
                <input
                  type="checkbox"
                  checked={image.tint !== null}
                  onChange={(e) =>
                    update(
                      `${prefix}.image.tint`,
                      e.target.checked ? buildColorWithOpacity("#000000", 50) : null
                    )
                  }
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </div>
              {image.tint !== null && (
                <ColorRow
                  hex={tint.hex}
                  opacity={tint.opacity}
                  onChange={(hex, opacity) =>
                    update(`${prefix}.image.tint`, buildColorWithOpacity(hex, opacity))
                  }
                />
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <ColorRow
                hex={colorHex}
                opacity={Math.round(surface.opacity * 100)}
                onChange={(hex, opacity) => {
                  update(`${prefix}.color`, hex)
                  update(`${prefix}.opacity`, opacity / 100)
                }}
              />
            </div>
          )}

          <SliderRow
            label="Corner Radius"
            suffix="px"
            value={surface.borderRadius}
            max={80}
            onChange={(v) => update(`${prefix}.borderRadius`, v)}
          />
          <SliderRow
            label="Padding"
            suffix="px"
            value={surface.padding}
            max={120}
            onChange={(v) => update(`${prefix}.padding`, v)}
          />
        </div>
      )}
    </div>
  )
}

function SliderRow({
  label,
  suffix,
  value,
  max,
  onChange,
}: {
  label: string
  suffix: string
  value: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  )
}

function ColorRow({
  hex,
  opacity,
  onChange,
}: {
  hex: string
  opacity: number
  onChange: (hex: string, opacity: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value, opacity)}
          className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <Input
          value={hex}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v, opacity)
          }}
          className="w-20 font-mono"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Opacity</label>
        <span className="text-xs tabular-nums text-muted-foreground">{opacity}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[opacity]}
        onValueChange={([v]) => onChange(hex, v)}
      />
    </div>
  )
}
