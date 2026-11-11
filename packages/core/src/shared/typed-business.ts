/**
 * What a visitor may type as a business name or a place on the free check (security S-04). Checked at
 * the boundary, before the bot check, the Places lookup or anything else that costs money: a name is at
 * most 120 characters, a place at most 80, and neither holds markup, control, bidi or zero-width
 * characters. Words that merely look like an instruction ("Prompt Uitzendbureau") pass here on purpose:
 * only the AI lookup refuses them (prompts/slots.ts), the check itself goes on.
 */
export const MAX_TYPED_NAME = 120;
export const MAX_TYPED_PLACE = 80;

export type TypedBusinessProblem = "too_long" | "markup" | "control";

const CONTROL = /[\p{Cc}\p{Cf}­​-‏⁠-⁤﻿]/u;

function problemOf(text: string, max: number): TypedBusinessProblem | null {
  if (text.length > max) return "too_long";
  if (CONTROL.test(text)) return "control";
  // NFKC first: a fullwidth "＜" is a "<" once a browser or a model reads it.
  if (/[<>]/.test(text.normalize("NFKC"))) return "markup";
  return null;
}

/** The first problem with the typed name or place, or null when both may go on. */
export function typedBusinessProblem(name: string, place?: string | null): TypedBusinessProblem | null {
  return problemOf(name, MAX_TYPED_NAME) ?? problemOf(place ?? "", MAX_TYPED_PLACE);
}
