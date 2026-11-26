// Which file header the step page pins over its code while it scrolls, as editors
// do: the file whose rows are at the top keeps its header in sight.

/**
 * @param {number} offset how far the page has scrolled
 * @param {number} top where the code card's first file starts in the page
 * @param {(number | undefined)[]} heights each file's rows, its header included, in order
 * @param {number} header a header's height
 * @returns {{ index: number, shift: number } | null} the file, and how far the next
 *   file's header pushes the pinned one up (0 or less); null when none is pinned
 */
export function stuckHeader(offset, top, heights, header) {
  if (heights.some((h) => typeof h !== "number")) return null;
  let start = top;
  for (const [index, height] of heights.entries()) {
    const end = start + height;
    if (start < offset && offset < end) return { index, shift: Math.min(0, end - offset - header) };
    start = end;
  }
  return null;
}
