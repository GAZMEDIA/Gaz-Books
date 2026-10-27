// Amazon KDP paperback rules (no bleed, text books). Sizes are in inches.
const TRIM_SIZES = {
  '5x8': [5, 8], '5.06x7.81': [5.06, 7.81], '5.25x8': [5.25, 8], '5.5x8.5': [5.5, 8.5],
  '6x9': [6, 9], '6.14x9.21': [6.14, 9.21], '6.69x9.61': [6.69, 9.61], '7x10': [7, 10],
  '7.44x9.69': [7.44, 9.69], '7.5x9.25': [7.5, 9.25], '8x10': [8, 10], '8.5x11': [8.5, 11],
};

// KDP minimum inside (gutter) margin depends on page count.
function gutterFor(pages) {
  if (pages <= 150) return 0.375;
  if (pages <= 300) return 0.5;
  if (pages <= 500) return 0.625;
  if (pages <= 700) return 0.75;
  return 0.875;
}

// Comfortable reading sizes per trim, in points.
function typeFor(trimW) {
  if (trimW <= 5.25) return { size: 10.5, leading: 14.5 };
  if (trimW <= 6.2) return { size: 11, leading: 15 };
  if (trimW <= 7.5) return { size: 11.5, leading: 16 };
  return { size: 12, leading: 17 };
}

const MAX_PAGES = 828;
const MIN_PAGES = 24;

function layoutSettings(opts, pageCount) {
  const [w, h] = TRIM_SIZES[opts.trim] || TRIM_SIZES['6x9'];
  const type = typeFor(w);
  const size = opts.fontSize ? +opts.fontSize : type.size;
  const leading = opts.fontSize ? Math.round(size * 1.36 * 2) / 2 : type.leading;
  // We add a little to the KDP minimums so nothing sits right on the edge.
  const gutter = gutterFor(pageCount || 200) + 0.125;
  return {
    trim: [w, h],
    pageW: w * 72, pageH: h * 72,
    inside: gutter * 72, outside: 0.5 * 72, top: 0.75 * 72, bottom: 0.75 * 72,
    size, leading,
  };
}

module.exports = { TRIM_SIZES, gutterFor, layoutSettings, MAX_PAGES, MIN_PAGES };
