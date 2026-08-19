import { useBroadcastStore } from "@/stores/broadcast-store"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { seedFreeBoxesForTheme } from "@/lib/theme-migrations"
import type { BroadcastTheme, ElementBox } from "@/types/broadcast"

function ElementBoxControls({
  label,
  boxKey,
}: {
  label: string
  boxKey: "referenceBox" | "verseBox"
}) {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)

  if (!draftTheme) return null
  const box = draftTheme.layout[boxKey]
  if (!box) return null
  const resolution = draftTheme.resolution

  const fields: {
    key: keyof ElementBox
    label: string
    axis: "width" | "height"
  }[] = [
    { key: "x", label: "X", axis: "width" },
    { key: "y", label: "Y", axis: "height" },
    { key: "width", label: "Width", axis: "width" },
    { key: "height", label: "Height", axis: "height" },
  ]

  return (
    <div className="flex flex-col gap-2">
      <h5 className="text-xs font-medium text-muted-foreground">{label}</h5>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => {
          const value = box[field.key]
          const px = Math.round(
            (value / 100) *
              (field.axis === "width" ? resolution.width : resolution.height)
          )
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
                <span className="text-[10px] tabular-nums text-muted-foreground">{px}px</span>
              </div>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={value}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v >= 0 && v <= 100) {
                    update(`layout.${boxKey}.${field.key}`, v)
                  }
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function LayoutProperties() {
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const update = useBroadcastStore((s) => s.updateDraftNested)
  const updateDraft = useBroadcastStore((s) => s.updateDraft)

  if (!draftTheme) return null

  const layout = draftTheme.layout
  const resolution = draftTheme.resolution
  const referenceGap = layout.referenceGap ?? Math.max(16, Math.round(draftTheme.reference.fontSize * 0.5))
  const freeMode = layout.mode === "free"

  const bgWidthPx = Math.round((layout.backgroundWidth / 100) * resolution.width)
  const bgHeightPx = Math.round((layout.backgroundHeight / 100) * resolution.height)
  // The text area is a percentage of the background region, not of the frame
  // (verse-renderer.ts computes it against bgW/bgH), so the readout has to
  // nest the same way or it lies whenever the background is not full-bleed.
  const textWidthPx = Math.round((layout.textAreaWidth / 100) * bgWidthPx)
  const textHeightPx = Math.round((layout.textAreaHeight / 100) * bgHeightPx)

  const toggleFreeMode = (enabled: boolean) => {
    if (!enabled) {
      update("layout.mode", "stacked")
      return
    }
    const patch: Partial<BroadcastTheme["layout"]> = { mode: "free" }
    if (!layout.referenceBox || !layout.verseBox) {
      const seeded = seedFreeBoxesForTheme(draftTheme)
      if (!seeded) return
      patch.referenceBox = seeded.referenceBox
      patch.verseBox = seeded.verseBox
    }
    updateDraft({ layout: { ...layout, ...patch } })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Positioning */}
      <div className="flex flex-col gap-0.5 pb-1">
        <h4 className="text-xs font-semibold">Positioning</h4>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Free positioning (detach reference)
        </label>
        <input
          type="checkbox"
          checked={freeMode}
          onChange={(e) => toggleFreeMode(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
      </div>

      {freeMode && (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-muted-foreground">
            Drag the reference or verse frame on the canvas, or set the boxes
            here (% of output size).
          </p>
          <ElementBoxControls label="Reference Block" boxKey="referenceBox" />
          <ElementBoxControls label="Verse Block" boxKey="verseBox" />
        </div>
      )}

      {/* Background Dimensions */}
      <div className="flex flex-col gap-0.5 border-t pt-3 pb-1">
        <h4 className="text-xs font-semibold">Background Dimensions</h4>
      </div>

      {/* Width */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Width</label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {layout.backgroundWidth}% ({bgWidthPx}px)
          </span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[layout.backgroundWidth]}
          onValueChange={([v]) => update("layout.backgroundWidth", v)}
        />
      </div>

      {/* Height */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Height</label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {layout.backgroundHeight}% ({bgHeightPx}px)
          </span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[layout.backgroundHeight]}
          onValueChange={([v]) => update("layout.backgroundHeight", v)}
        />
      </div>

      {/* Text Area Dimensions */}
      <div className="flex flex-col gap-0.5 border-t pt-3 pb-1">
        <h4 className="text-xs font-semibold">Text Area Dimensions</h4>
      </div>

      {/* Text Width */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Text Width</label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {layout.textAreaWidth}% ({textWidthPx}px)
          </span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[layout.textAreaWidth]}
          onValueChange={([v]) => update("layout.textAreaWidth", v)}
        />
      </div>

      {/* Text Height */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Text Height</label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {layout.textAreaHeight}% ({textHeightPx}px)
          </span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[layout.textAreaHeight]}
          onValueChange={([v]) => update("layout.textAreaHeight", v)}
        />
      </div>

      {/* Padding */}
      <div className="flex flex-col gap-0.5 border-t pt-3 pb-1">
        <h4 className="text-xs font-semibold">Padding</h4>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Top</label>
          <Input
            type="number"
            min={0}
            value={layout.padding.top}
            onChange={(e) => update("layout.padding.top", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Right</label>
          <Input
            type="number"
            min={0}
            value={layout.padding.right}
            onChange={(e) => update("layout.padding.right", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Bottom</label>
          <Input
            type="number"
            min={0}
            value={layout.padding.bottom}
            onChange={(e) => update("layout.padding.bottom", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Left</label>
          <Input
            type="number"
            min={0}
            value={layout.padding.left}
            onChange={(e) => update("layout.padding.left", Number(e.target.value))}
          />
        </div>
      </div>

      {/* Element Spacing + Reference Position (stacked mode only) */}
      {!freeMode && (
        <>
          <div className="flex flex-col gap-0.5 border-t pt-3 pb-1">
            <h4 className="text-xs font-semibold">Element Spacing</h4>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Verse / Reference</label>
              <span className="text-xs tabular-nums text-muted-foreground">{referenceGap}px</span>
            </div>
            <Slider
              min={0}
              max={200}
              step={1}
              value={[referenceGap]}
              onValueChange={([v]) => update("layout.referenceGap", v)}
            />
          </div>

          {/* Display Options */}
          <div className="flex flex-col gap-0.5 border-t pt-3 pb-1">
            <h4 className="text-xs font-semibold">Display Options</h4>
          </div>

          {/* Reference Position */}
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
        </>
      )}
    </div>
  )
}
