// React → Vue inline-style bridge. React appends `px` to unitless numbers on
// dimensional properties; Vue writes the number as-is (which the browser
// ignores). Vendored geometry returns React-style objects, so normalise them.

const UNITLESS = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexPositive',
  'flexShrink',
  'flexNegative',
  'flexOrder',
  'gridArea',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'fontWeight',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  'fillOpacity',
  'floodOpacity',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
]);

export type StyleInput = Record<string, string | number | null | undefined | false>;
export type StyleObject = Record<string, string>;

/** Convert a React-style inline style object into a Vue style object. */
export function px(style: StyleInput | null | undefined): StyleObject {
  const out: StyleObject = {};
  if (!style) return out;
  for (const [key, value] of Object.entries(style)) {
    if (value === null || value === undefined || value === false || value === '') continue;
    if (typeof value === 'number') {
      out[key] = key.startsWith('--') || UNITLESS.has(key) || value === 0 ? String(value) : `${value}px`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Join class names, dropping falsy entries (React `className` strings). */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
