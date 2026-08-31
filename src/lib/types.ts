/**
 * Shared domain types.
 *
 * These are hand-written rather than generated from the database so the repo is
 * runnable without a Supabase project attached. Once you have one, you can
 * replace this with `supabase gen types typescript` output — the shapes match
 * supabase/migrations/0001_initial_schema.sql.
 */

export type TonePreference =
  | "secular"
  | "christian"
  | "buddhist"
  | "muslim"
  | "jewish"
  | "hindu"
  | "mindfulness"
  | "blended";

export type CalendarProvider = "google" | "microsoft";
export type ThemePreference = "system" | "light" | "dark";
export type AudioStatus =
  | "pending"
  | "synthesizing"
  | "ready"
  | "failed"
  | "skipped";
export type MeditationLength = 5 | 10 | 15;
export type Mood = "heavy" | "tender" | "steady" | "light" | "radiant";

export interface Profile {
  user_id: string;
  display_name: string;
  mantra: string;
  life_quest: string;
  tone_preference: TonePreference;
  meditation_length_pref: MeditationLength;
  timezone: string;
  reference_events_by_name: boolean;
  theme_preference: ThemePreference;
  reminder_email_enabled: boolean;
  onboarded_at: string | null;
  is_admin: boolean;
  /** Draws Daily Light from the family-facing set. */
  family_mode: boolean;
  generation_failures: number;
  generation_failed_at: string | null;
  generation_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe projection of calendar_connections — deliberately excludes token columns. */
export interface CalendarConnectionSummary {
  id: string;
  provider: CalendarProvider;
  account_email: string | null;
  connected_at: string;
  last_synced_at: string | null;
  invalid_since: string | null;
}

export interface DailyMeditation {
  id: string;
  user_id: string;
  local_date: string;
  script_text: string;
  why_today: string;
  audio_url: string | null;
  audio_status: AudioStatus;
  audio_duration_seconds: number | null;
  audio_attempts: number;
  audio_claimed_at: string | null;
  audio_error: string | null;
  calendar_signal: CalendarSignal;
  tone_used: TonePreference;
  length_used: MeditationLength;
  completed_at: string | null;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  meditation_id: string | null;
  reflection_text: string | null;
  mood: Mood | null;
  created_at: string;
}

/**
 * The derived shape of a user's day.
 *
 * This is the ONLY calendar-derived thing we persist. It carries no event IDs,
 * no attendees, no times beyond coarse buckets, and — unless the user opts in —
 * no titles. See src/lib/calendar/signal.ts for how it is built.
 */
export interface CalendarSignal {
  /** Total events considered today (declined and all-day events excluded). */
  meetingCount: number;
  /** Meetings starting within 15 minutes of the previous one ending. */
  backToBackCount: number;
  /** Longest uninterrupted gap during working hours, in minutes. */
  longestFreeBlockMinutes: number;
  /** Total scheduled time, in minutes. */
  totalMeetingMinutes: number;
  /** Coarse shape of the day, used directly in the prompt. */
  density: "open" | "light" | "moderate" | "packed";
  /** Which part of the day carries the most weight. */
  heaviestPart: "morning" | "afternoon" | "evening" | "none";
  /** True when the first event starts before 9am local. */
  hasEarlyStart: boolean;
  /** True when anything runs past 6pm local. */
  runsLate: boolean;
  /**
   * Event titles, present ONLY when the user has opted into
   * `reference_events_by_name`. Never written to the database — stripped in
   * persistForStorage() before the signal is saved.
   */
  eventTitles?: string[];
  /** True when no calendar is connected at all — the prompt handles this case. */
  noCalendarConnected: boolean;
}
