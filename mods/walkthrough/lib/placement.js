// Where a walkthrough is shown (GLOSSARY.md: Placement).

export const PLACEMENTS = [
  { key: "dialog", label: "Dialog", about: "Float over the agent" },
  { key: "pane", label: "Pane", about: "Keep it beside the agent" },
  { key: "tab", label: "Tab", about: "Give it a tab of its own" },
];

/**
 * This copy's Placement, from its props ({overlay, pane}), Herdr's panes and its Origin tab.
 * A pane outside the Origin tab, or alone in its tab, is a Tab.
 */
export function placementOf(p, panes, origin) {
  if (p?.overlay) return "dialog";
  const mine = panes.find((x) => x.pane === p?.pane);
  if (!mine) return "pane";
  return mine.tab !== origin || panes.filter((x) => x.tab === mine.tab).length === 1 ? "tab" : "pane";
}
