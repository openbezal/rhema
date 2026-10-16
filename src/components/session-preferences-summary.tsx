import type { SessionDocument } from "@/lib/session-archive"

export function SessionPreferencesSummary({
  preferences,
  showLanguages = true,
}: {
  preferences: SessionDocument["preferences"]
  showLanguages?: boolean
}) {
  return (
    <>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        {showLanguages && (
          <>
            <dt className="text-muted-foreground">Primary Bible</dt>
            <dd>{preferences.primaryTranslationCode ?? "Unconfirmed"}</dd>
            <dt className="text-muted-foreground">Secondary Bible</dt>
            <dd>{preferences.secondaryTranslationCode ?? "None"}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Transcription provider</dt>
        <dd>
          {preferences.settings.sttProvider === "deepgram"
            ? "Deepgram"
            : "Local Whisper"}
        </dd>
        <dt className="text-muted-foreground">Input gain</dt>
        <dd>{preferences.settings.gain}×</dd>
        <dt className="text-muted-foreground">Detection threshold</dt>
        <dd>{preferences.settings.confidenceThreshold * 100}%</dd>
        <dt className="text-muted-foreground">Detection cooldown</dt>
        <dd>{preferences.settings.cooldownMs} ms</dd>
        <dt className="text-muted-foreground">Quotation history capacity</dt>
        <dd>{preferences.settings.suggestionCapacity}</dd>
        <dt className="text-muted-foreground">Quotation retention</dt>
        <dd>{preferences.settings.suggestionRetentionMs / 1000} s</dd>
        <dt className="text-muted-foreground">Automatic detection</dt>
        <dd>{preferences.settings.autoMode ? "Enabled" : "Disabled"}</dd>
        <dt className="text-muted-foreground">Follow detections</dt>
        <dd>{preferences.followDetections ? "Enabled" : "Disabled"}</dd>
        <dt className="text-muted-foreground">Auto live</dt>
        <dd>{preferences.autoLive ? "Enabled" : "Disabled"}</dd>
        <dt className="text-muted-foreground">Saved custom themes</dt>
        <dd>{preferences.customThemes.length}</dd>
      </dl>
      {preferences.customThemes.length > 0 && (
        <ul className="list-inside list-disc text-sm">
          {preferences.customThemes.map((theme, index) => (
            <li key={index}>{theme.name}</li>
          ))}
        </ul>
      )}
    </>
  )
}
