"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Field,
  Input,
  Notice,
  OptionCard,
  Textarea,
} from "@/components/ui";
import { CalendarConnect } from "@/components/CalendarConnect";
import {
  LENGTH_OPTIONS,
  TONE_OPTIONS,
  TRADITION_DISCLAIMER,
} from "@/lib/tone-options";
import type {
  CalendarConnectionSummary,
  CalendarProvider,
  MeditationLength,
  Profile,
  ThemePreference,
  TonePreference,
} from "@/lib/types";
import { regenerateToday, updateSettings } from "./actions";

export function SettingsForm({
  profile,
  connections,
  configured,
}: {
  profile: Profile;
  connections: CalendarConnectionSummary[];
  configured: Record<CalendarProvider, boolean>;
}) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(profile.display_name);
  const [mantra, setMantra] = useState(profile.mantra);
  const [lifeQuest, setLifeQuest] = useState(profile.life_quest);
  const [tone, setTone] = useState<TonePreference>(profile.tone_preference);
  const [length, setLength] = useState<MeditationLength>(
    profile.meditation_length_pref,
  );
  const [referenceEvents, setReferenceEvents] = useState(
    profile.reference_events_by_name,
  );
  const [familyMode, setFamilyMode] = useState(profile.family_mode);
  const [theme, setTheme] = useState<ThemePreference>(profile.theme_preference);
  const [reminderEmail, setReminderEmail] = useState(
    profile.reminder_email_enabled,
  );

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Theme applies immediately rather than on save — a colour scheme you have to
   * commit to before seeing is a bad way to choose one. localStorage keeps it
   * across reloads before the profile write lands (see ThemeScript).
   */
  function applyTheme(next: ThemePreference) {
    setTheme(next);
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("lumsa-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("lumsa-theme", next);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const result = await updateSettings({
      displayName,
      mantra,
      lifeQuest,
      tone,
      length,
      referenceEventsByName: referenceEvents,
      familyMode,
      theme,
      reminderEmailEnabled: reminderEmail,
      // Re-read on save so a user who has travelled gets the right timezone
      // without having to think about it.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    setMessage(null);

    const result = await regenerateToday();
    setRegenerating(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/today");
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <SectionTitle>Your practice</SectionTitle>

        <Field label="Name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
          />
        </Field>

        <Field
          label="Mantra"
          hint="Woven into each practice and returned to you a few times."
        >
          <Textarea
            rows={2}
            value={mantra}
            onChange={(e) => setMantra(e.target.value)}
            maxLength={400}
          />
        </Field>

        <Field
          label="What you're working toward"
          hint="Change this whenever it changes. Practices follow it."
        >
          <Textarea
            rows={3}
            value={lifeQuest}
            onChange={(e) => setLifeQuest(e.target.value)}
            maxLength={600}
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Tone</SectionTitle>
        <div className="space-y-2">
          {TONE_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              selected={tone === option.value}
              onClick={() => setTone(option.value)}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-faint">
          {TRADITION_DISCLAIMER}
        </p>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Length</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {LENGTH_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              selected={length === option.value}
              onClick={() => setLength(option.value)}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Calendar</SectionTitle>
        <CalendarConnect
          connections={connections}
          configured={configured}
          returnTo="/settings"
        />

        <Toggle
          checked={referenceEvents}
          onChange={setReferenceEvents}
          label="Let Lumsa name my events"
          description="Off, your daily line describes the shape of the day — “three things close together this afternoon.” On, it may name one event directly. Titles are still never stored either way."
        />
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Today&rsquo;s Light</SectionTitle>
        <Toggle
          checked={familyMode}
          onChange={setFamilyMode}
          label="Family mode"
          description="Draws the daily invitation from acts you can do with children — and leaves out the ones written for adults on their own."
        />
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Appearance</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { value: "system", title: "System", description: "Follow your device." },
              { value: "light", title: "Cream", description: "Warm and light." },
              { value: "dark", title: "Night", description: "Deep and quiet." },
            ] as const
          ).map((option) => (
            <OptionCard
              key={option.value}
              selected={theme === option.value}
              onClick={() => applyTheme(option.value)}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>Reminders</SectionTitle>
        <Toggle
          checked={reminderEmail}
          onChange={setReminderEmail}
          label="Daily email"
          description="A short note each morning with today's line and a link to your practice."
        />
      </Card>

      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="info">{message}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} loading={saving}>
          Save changes
        </Button>
        <Button
          variant="secondary"
          onClick={handleRegenerate}
          loading={regenerating}
        >
          Regenerate today
        </Button>
      </div>

      <p className="text-[13px] leading-relaxed text-faint">
        Changes to your mantra, quest, or tone apply from tomorrow. To hear them
        in today&rsquo;s practice, save first, then regenerate.
      </p>

      <Card className="space-y-4">
        <SectionTitle>Account</SectionTitle>
        <p className="text-[13px] text-muted">
          Signed in as {profile.display_name || "you"} · {profile.timezone}
        </p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg text-text">{children}</h2>;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3.5 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong"
    >
      <span
        aria-hidden="true"
        className={
          checked
            ? "mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full bg-gold px-0.5 transition-colors"
            : "mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full bg-border px-0.5 transition-colors"
        }
      >
        <span
          className={
            checked
              ? "h-5 w-5 translate-x-4 rounded-full bg-canvas transition-transform"
              : "h-5 w-5 translate-x-0 rounded-full bg-surface transition-transform"
          }
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
          {description}
        </span>
      </span>
    </button>
  );
}
