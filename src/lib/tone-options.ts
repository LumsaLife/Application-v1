/**
 * Copy for the tone and length pickers.
 *
 * Shared between onboarding and settings so the two can never drift. The
 * descriptions matter more than they look: this is where Lumsa tells the user
 * what choosing a tradition does and — just as importantly — what it does not.
 */

import type { MeditationLength, TonePreference } from "./types";

export const TONE_OPTIONS: {
  value: TonePreference;
  title: string;
  description: string;
}[] = [
  {
    value: "secular",
    title: "Open / non-denominational",
    description: "Warm and spacious, drawing on nature, breath and light.",
  },
  {
    value: "mindfulness",
    title: "Secular mindfulness",
    description: "Plain and precise. Body, breath, noticing without judgement.",
  },
  {
    value: "christian",
    title: "Christian",
    description: "Grace, stillness, being held. Contemplative in feel.",
  },
  {
    value: "buddhist",
    title: "Buddhist",
    description: "Impermanence, returning, loving-kindness.",
  },
  {
    value: "muslim",
    title: "Muslim",
    description: "Remembrance, gratitude, the discipline of returning.",
  },
  {
    value: "jewish",
    title: "Jewish",
    description: "Intention, blessing the ordinary, honest wrestling.",
  },
  {
    value: "hindu",
    title: "Hindu",
    description: "The still witness, breath as life-force, devoted attention.",
  },
  {
    value: "blended",
    title: "Surprise me",
    description: "Draws on the shared language of many traditions.",
  },
];

export const LENGTH_OPTIONS: {
  value: MeditationLength;
  title: string;
  description: string;
}[] = [
  { value: 5, title: "5 minutes", description: "A short settling." },
  { value: 10, title: "10 minutes", description: "Room to arrive properly." },
  { value: 15, title: "15 minutes", description: "A full practice." },
];

/**
 * Shown under the tradition picker. This is a promise about what the product
 * is, and the wording was chosen carefully — keep it if you edit around it.
 */
export const TRADITION_DISCLAIMER =
  "This shapes the words and images in your practice — nothing more. " +
  "Lumsa isn't a religious authority and won't speak for any tradition or " +
  "make claims on its behalf.";
