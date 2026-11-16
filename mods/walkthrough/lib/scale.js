// Text sizes and the boxes that hold them, at Herdr's own size. Two settings
// move them: "font_size" sets the text (every role keeps its ratio to the body
// text), "scale" the icons and fixed heights. Herdr's zoom still applies on top.

/** The settings' defaults and bounds, as mod.schema.json describes them. */
export const DEFAULTS = { font_size: 13, scale: 1 };
export const BOUNDS = { font_size: [9, 24], scale: [0.8, 1.6] };

// font_size's default is BASE.base: the text the whole view is drawn in.
const BASE = { caret: 9, badge: 9.5, tiny: 10, label: 10.5, small: 11, note: 11.5, body: 12, ui: 12.5, base: 13, strong: 13.5, heading: 14, title: 17, page: 18 };

/** Text sizes in px, by role, for the current font_size. */
export const TEXT = { ...BASE };

let text = 1, scale = DEFAULTS.scale;

/** An icon or other box with no text in it, `n` px at Herdr's own size, in whole px. */
export const px = (n) => Math.round(n * scale);

/** A height or width that holds text, `n` px at Herdr's own size: it grows with the text or the scale, whichever is larger, so text always fits. */
export const grow = (n) => Math.round(n * Math.max(scale, text));

const fit = (value, key) => (typeof value === "number" && Number.isFinite(value) ? Math.min(BOUNDS[key][1], Math.max(BOUNDS[key][0], value)) : DEFAULTS[key]);

/** Applies a mod.json `settings` block's font_size and scale; a missing or wrong value is the default. */
export function setSizes(settings) {
  text = fit(settings?.font_size, "font_size") / DEFAULTS.font_size;
  scale = fit(settings?.scale, "scale");
  for (const [role, size] of Object.entries(BASE)) TEXT[role] = size * text;
}
