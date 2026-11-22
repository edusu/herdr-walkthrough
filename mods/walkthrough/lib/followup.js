// A second, closer look at one step, asked of the model that wrote the
// walkthrough and shown under the step's explanation. Like the walkthrough it
// explains and does not judge. An answer is kept in the walkthrough's entry,
// so it is paid for once.

import { DEFAULT_LANGUAGE, languageOf } from "./languages.js";
import { numberLines } from "./hunks.js";

export const FOLLOW_UPS = [
  { key: "deeper", name: "Deeper", about: "How this step works, one level further down" },
  { key: "technical", name: "More technical", about: "The same step in precise terms: types, contracts, edge cases" },
];

export const FOLLOW_SCHEMA = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } };

const ASKS = {
  deeper: "Go one level deeper than the explanation: how the code gets its result, the order things happen in, what each piece hands to the next, and the cases it handles on the way.",
  technical: "Restate the step for an engineer who wants precision: the types and signatures involved, the contracts and invariants the code relies on or sets up, its edge cases, and the APIs it calls.",
};

const SYSTEM = (kind) => `You are guiding an engineer through a code change they did not write. They have read your explanation of one step of it and asked for more. ${ASKS[kind]}

Rest everything on the code shown. Do not repeat the explanation, and do not narrate the edits line by line. Describe, never instruct: no "make sure", "verify", "consider". You are not grading the change: no suspected bugs, no remarks on style, no suggestions.
Name a place in the code as path:line, with the path as given and a line number of the new file ("src/retry.js:40").
Write one to three short paragraphs of plain sentences, at most 180 words: no markdown, no lists, no code fences.

Answer with a single JSON object {"text": "..."} and nothing else.`;

/**
 * @param {{ kind: "deeper" | "technical", step: any, title: string, what: string, language?: string }} input
 *   step: an `overlay` step (its `found` hunks are the code sent)
 */
export function followPrompt({ kind, step, title, what, language = DEFAULT_LANGUAGE }) {
  const blocks = [];
  let last = null;
  for (const { file, hunk } of step.found) {
    if (file.path !== last) blocks.push(`=== ${file.path}`);
    last = file.path;
    blocks.push(hunk.header, ...numberLines(hunk).map((l) => (l.kind === "meta" ? l.text : `${l.kind} ${l.number}: ${l.text}`)));
  }
  const prompt = `The change: ${what}
The walkthrough: ${title}

The step: ${step.title}
Your explanation of it: ${step.text}

Its code: each file starts with "=== path", each hunk with its @@ header. A line starts with + (added), - (removed) or a space (unchanged), then its number; a removed line's number is its number in the old file.

${blocks.join("\n")}`;
  const system = `${SYSTEM(kind)}${language === DEFAULT_LANGUAGE ? "" : `\n\nWrite in ${languageOf(language).english}. Keep identifiers, file paths and API names as they appear in the code.`}`;
  return { system, prompt };
}

/** A model's answer → its text; thrown when there is none. */
export function readFollowUp(raw) {
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) throw new Error("The model returned no answer.");
  return text;
}

/** The entry with one more answer: { text, cost } for a step and kind. */
export const withFollowUp = (entry, stepId, kind, answer) =>
  ({ ...entry, followUps: { ...entry.followUps, [stepId]: { ...entry.followUps?.[stepId], [kind]: answer } } });

/** A step's answers, in the order of FOLLOW_UPS: [{ key, name, text }]. */
export const followUpsOf = (entry, stepId) =>
  FOLLOW_UPS.filter((f) => entry?.followUps?.[stepId]?.[f.key]).map((f) => ({ key: f.key, name: f.name, text: entry.followUps[stepId][f.key].text }));
