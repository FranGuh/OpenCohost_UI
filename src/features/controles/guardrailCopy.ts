import type { TKey } from "../../i18n/t.js";

const rule = (id: string, withNote = false): { name: TKey; desc: TKey; note?: TKey } => ({
  name: `controles.guardrails.rule.${id}.name` as TKey,
  desc: `controles.guardrails.rule.${id}.desc` as TKey,
  ...(withNote ? { note: `controles.guardrails.note.${id}` as TKey } : {})
});

/**
 * i18n keys per known rule id (a key-completeness test in GuardrailsCard.test
 * guards the casts). Ids the API returns that are not listed here (future
 * rules arrive as data) fall back to the raw id plus a generic line. Which
 * rules are toggleable is NEVER decided here: that comes from `tier`.
 */
export const GUARDRAIL_COPY: Record<string, { name: TKey; desc: TKey; note?: TKey }> = {
  no_doxxing: rule("no_doxxing"),
  no_suspicious_links: rule("no_suspicious_links"),
  never_promise: rule("never_promise"),
  never_invent_confirmations: rule("never_invent_confirmations"),
  never_moderate_automatically: rule("never_moderate_automatically"),
  no_personal_viewer_data: rule("no_personal_viewer_data"),
  no_raw_spam_to_llm: rule("no_raw_spam_to_llm"),
  no_hate_speech: rule("no_hate_speech"),
  no_code_output: rule("no_code_output"),
  no_memory_denial: rule("no_memory_denial"),
  no_false_capability: rule("no_false_capability"),
  no_ai_self_identification: rule("no_ai_self_identification", true),
  no_meta_commentary: rule("no_meta_commentary"),
  no_negative_engagement: rule("no_negative_engagement"),
  no_isolation_pressure: rule("no_isolation_pressure")
};
