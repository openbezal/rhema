import { useBroadcastStore } from "@/stores/broadcast-store"
import { pickThemeBackgroundImage } from "@/lib/theme-designer-files"
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
import { SurfaceControls } from "@/components/broadcast/surface-properties"
import { buildColorWithOpacity, parseColorOpacity } from "@/lib/color-utils"

function SolidSection() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">Background Color</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={draftTheme.background.color}
          onChange={(e) => update("background.color", e.target.value)}
          className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <Input
          value={draftTheme.background.color}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              update("background.color", v)
            }
          }}
          className="w-24 font-mono"
        />
      </div>
    </div>
  )
}

function GradientSection() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme || !draftTheme.background.gradient) return null

  const gradient = draftTheme.background.gradient
  const stop0 = gradient.stops[0] ?? { color: "#000000", position: 0 }
  const stop1 = gradient.stops[1] ?? { color: "#ffffff", position: 100 }

  return (
    <div className="flex flex-col gap-3">
      {/* Gradient Type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Gradient Type</label>
        <Select
          value={gradient.type}
          onValueChange={(v) => update("background.gradient.type", v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="radial">Radial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Angle (only for linear) */}
      {gradient.type === "linear" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Angle</label>
            <span className="text-xs tabular-nums text-muted-foreground">{gradient.angle}&deg;</span>
          </div>
          <Slider
            min={0}
            max={360}
            step={1}
            value={[gradient.angle]}
            onValueChange={([v]) => update("background.gradient.angle", v)}
          />
        </div>
      )}

      {/* Color Stop 1 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Color Stop 1</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={stop0.color}
            onChange={(e) => update("background.gradient.stops.0.color", e.target.value)}
            className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
          />
          <Input
            value={stop0.color}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                update("background.gradient.stops.0.color", v)
              }
            }}
            className="w-20 font-mono"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Position</label>
          <span className="text-xs tabular-nums text-muted-foreground">{stop0.position}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[stop0.position]}
          onValueChange={([v]) => update("background.gradient.stops.0.position", v)}
        />
      </div>

      {/* Color Stop 2 */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Color Stop 2</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={stop1.color}
            onChange={(e) => update("background.gradient.stops.1.color", e.target.value)}
            className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
          />
          <Input
            value={stop1.color}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                update("background.gradient.stops.1.color", v)
              }
            }}
            className="w-20 font-mono"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Position</label>
          <span className="text-xs tabular-nums text-muted-foreground">{stop1.position}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[stop1.position]}
          onValueChange={([v]) => update("background.gradient.stops.1.position", v)}
        />
      </div>
    </div>
  )
}

function ImageSection() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme || !draftTheme.background.image) return null

  const image = draftTheme.background.image
  const tint = image.tint ? parseColorOpacity(image.tint) : { hex: "#000000", opacity: 50 }

  return (
    <div className="flex flex-col gap-3">
      {/* Image Source */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Background Image</label>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            void (async () => {
              const dataUrl = await pickThemeBackgroundImage()
              if (dataUrl) update("background.image.url", dataUrl)
            })()
          }}
        >
          Change Image
        </Button>
      </div>

      {/* Fit Mode */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Fit Mode</label>
        <Select
          value={image.fit}
          onValueChange={(v) => update("background.image.fit", v)}
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

      {/* Effects */}
      <div className="flex flex-col gap-3 border-t pt-3">
        <h4 className="text-xs font-semibold">Effects</h4>

        {/* Blur */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Blur</label>
            <span className="text-xs tabular-nums text-muted-foreground">{image.blur}px</span>
          </div>
          <Slider
            min={0}
            max={50}
            step={1}
            value={[image.blur]}
            onValueChange={([v]) => update("background.image.blur", v)}
          />
        </div>

        {/* Brightness */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Brightness</label>
            <span className="text-xs tabular-nums text-muted-foreground">{image.brightness}%</span>
          </div>
          <Slider
            min={0}
            max={200}
            step={1}
            value={[image.brightness]}
            onValueChange={([v]) => update("background.image.brightness", v)}
          />
        </div>
      </div>

      {/* Color Overlay */}
      <div className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold">Color Overlay</h4>
          <input
            type="checkbox"
            checked={image.tint !== null}
            onChange={(e) => {
              if (e.target.checked) {
                update("background.image.tint", buildColorWithOpacity("#000000", 50))
              } else {
                update("background.image.tint", null)
              }
            }}
            className="h-4 w-4 rounded border-input accent-primary"
          />
        </div>

        {image.tint !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={tint.hex}
                onChange={(e) =>
                  update("background.image.tint", buildColorWithOpacity(e.target.value, tint.opacity))
                }
                className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
              />
              <Input
                value={tint.hex}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    update("background.image.tint", buildColorWithOpacity(v, tint.opacity))
                  }
                }}
                className="w-20 font-mono"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Opacity</label>
              <span className="text-xs tabular-nums text-muted-foreground">{tint.opacity}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[tint.opacity]}
              onValueChange={([v]) =>
                update("background.image.tint", buildColorWithOpacity(tint.hex, v))
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TransparentSection() {
  return (
    <div className="rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        Background is transparent for NDI overlay mode
      </p>
    </div>
  )
}

export function BackgroundProperties() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null

  const bgType = draftTheme.background.type

  return (
    <div className="flex flex-col gap-3">
      {/* Background Type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Background Type</label>
        <Select
          value={bgType}
          onValueChange={(v) => {
            update("background.type", v)
            // Initialize gradient/image if switching to those types
            if (v === "gradient" && !draftTheme.background.gradient) {
              update("background.gradient", {
                type: "linear",
                angle: 180,
                stops: [
                  { color: "#000000", position: 0 },
                  { color: "#ffffff", position: 100 },
                ],
              })
            }
            if (v === "image" && !draftTheme.background.image) {
              update("background.image", {
                url: "",
                fit: "cover",
                blur: 0,
                brightness: 100,
                tint: null,
              })
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid Color</SelectItem>
            <SelectItem value="gradient">Gradient</SelectItem>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="transparent">Transparent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Conditional sections */}
      {bgType === "solid" && <SolidSection />}
      {bgType === "gradient" && <GradientSection />}
      {bgType === "image" && <ImageSection />}
      {bgType === "transparent" && <TransparentSection />}

      {/* The container the reference + verse sit in — always available. */}
      <SurfaceControls
        prefix="textBox"
        title="Text Container"
        description="The box the reference and verse sit in"
      />
    </div>
  )
}
