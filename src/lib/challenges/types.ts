/**
 * Daily Light types.
 *
 * Kept separate from the selection logic so the seed script and the UI can
 * import shapes without pulling in the selector.
 */

export type ChallengeCategory =
  | "generosity"
  | "connection"
  | "grace"
  | "presence"
  | "words"
  | "service"
  | "gratitude"
  | "family";

export type ChallengeEffort = 1 | 2 | 3;
export type ChallengeCost = "none" | "small";
export type ChallengeContext = "anywhere" | "out" | "work" | "home";
export type ChallengeAudience = "adult" | "family" | "both";
export type UserChallengeStatus = "offered" | "completed" | "skipped";

export interface Challenge {
  id: string;
  slug: string;
  title: string;
  invitation: string;
  category: ChallengeCategory;
  effort: ChallengeEffort;
  cost: ChallengeCost;
  context: ChallengeContext;
  audience: ChallengeAudience;
  requires_others: boolean;
  weight: number;
  active: boolean;
}

export interface UserChallenge {
  id: string;
  user_id: string;
  challenge_id: string;
  local_date: string;
  status: UserChallengeStatus;
  completed_at: string | null;
  reflection_text: string | null;
  /** Challenges passed over today. Length is how many swaps have been spent. */
  skipped_challenge_ids: string[];
  created_at: string;
  updated_at: string;
}

/** A user_challenge row joined to the challenge it offered. */
export interface TodaysLight {
  userChallenge: UserChallenge;
  challenge: Challenge;
  /** False once the day's single swap has been used. */
  canSwap: boolean;
}
