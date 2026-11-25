// Framework-free parts of upstream apps/web/src/components/ManualEditPanel.tsx
// (nexu-io/open-design, Apache-2.0): the inspector draft model, style
// normalisation, readable target names, option lists and number stepping.
// The Vue inspector components (ManualEditPanel.vue + manual-edit/*.vue) use them.
import type { ProjectDesignTokenSuggestionProp } from '../../shims/registry';
import { emptyManualEditStyles, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../../edit-mode/types';

export interface ManualEditDraft {
  text: string;
  href: string;
  src: string;
  alt: string;
  styles: ManualEditStyles;
  attributesText: string;
  outerHtml: string;
  fullSource: string;
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '',
    href: '',
    src: '',
    alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}',
    outerHtml: '',
    fullSource: source,
  };
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export function readableManualEditTargetName(target: ManualEditTarget): string {
  const explicit = firstReadableText(target.attributes['data-od-label'], target.attributes['aria-label'], target.attributes.title);
  if (explicit) return explicit;

  if (target.kind === 'text' || target.kind === 'link' || target.kind === 'token') {
    const textName = readableContentName(target.text || target.fields.text || target.label);
    if (textName) return textName;
  }
  if (target.kind === 'image') {
    const imageName = readableContentName(target.fields.alt || target.label);
    if (imageName) return imageName;
  }

  const identifierName = readableIdentifierName(target.attributes.id || target.attributes['data-od-id'] || target.id);
  if (identifierName) return identifierName;

  const className = readableClassName(target.className);
  if (className) return className;

  const labelName = readableContentName(target.label);
  if (labelName && !looksCodeLikeLabel(labelName)) return labelName;

  if (target.kind === 'container') return 'Container';
  if (target.kind === 'image') return 'Image';
  if (target.kind === 'link') return 'Link';
  return 'Text';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstReadableText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const readable = readableContentName(value);
    if (readable) return readable;
  }
  return '';
}

function readableContentName(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (looksGeneratedIdentifier(clean)) return '';
  return clean.length > 42 ? `${clean.slice(0, 39).trim()}...` : clean;
}

function readableIdentifierName(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || looksGeneratedIdentifier(raw)) return '';
  const lastSelectorPart = (raw.includes('.') ? raw.split('.').filter(Boolean).at(-1) : raw) ?? '';
  const lastIdPart = (lastSelectorPart.includes('#') ? lastSelectorPart.split('#').filter(Boolean).at(-1) : lastSelectorPart) ?? '';
  return humanizeIdentifier(lastIdPart);
}

function readableClassName(value: string | undefined): string {
  const classes = (value ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const candidate =
    classes.find((item) => {
      const lower = item.toLowerCase();
      return !looksGeneratedIdentifier(item) && !['container', 'wrapper', 'group', 'section', 'row', 'col'].includes(lower);
    }) ?? classes.find((item) => !looksGeneratedIdentifier(item));
  return humanizeIdentifier(candidate);
}

function humanizeIdentifier(value: string | undefined): string {
  const clean = (value ?? '')
    .replace(/^[_#.\s-]+|[_#.\s-]+$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || looksGeneratedIdentifier(clean)) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function looksCodeLikeLabel(value: string): boolean {
  return /^[a-z][a-z0-9-]*(?:[#.][\w-]+)+$/i.test(value) || /^[a-z][a-z0-9-]*\s+#/.test(value);
}

function looksGeneratedIdentifier(value: string): boolean {
  return /^path(?:-\d+)+$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export const FONT_OPTS = [
  { label: 'inherit', value: '' },
  { label: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'monospace', value: 'SFMono-Regular, Consolas, "Liberation Mono", monospace' },
] as const;
export const WEIGHT_OPTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const ALIGN_OPTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
const DIRECTION_OPTS = ['', 'row', 'column', 'row-reverse', 'column-reverse'];
const JUSTIFY_OPTS = ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
const ITEMS_OPTS = ['', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const BORDER_STYLE_OPTS = ['', 'solid', 'dashed', 'dotted', 'double', 'none'];
export const EDITOR_SWATCH_COLORS = [
  '#000000',
  '#ffffff',
  '#374151',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

type NormalizeResult = { ok: true; styles: Partial<ManualEditStyles> } | { ok: false; error: string };

const PX_STYLE_PROPS = new Set<keyof ManualEditStyles>([
  'fontSize',
  'letterSpacing',
  'width',
  'height',
  'minHeight',
  'gap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'border',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
]);
const COLOR_STYLE_PROPS = new Set<keyof ManualEditStyles>(['color', 'backgroundColor', 'borderColor']);
const SELECT_STYLE_OPTIONS: Partial<Record<keyof ManualEditStyles, ReadonlyArray<string>>> = {
  fontFamily: FONT_OPTS.map((option) => option.value),
  fontWeight: WEIGHT_OPTS,
  textAlign: ALIGN_OPTS,
  flexDirection: DIRECTION_OPTS,
  justifyContent: JUSTIFY_OPTS,
  alignItems: ITEMS_OPTS,
  borderStyle: BORDER_STYLE_OPTS,
};
const LAYOUT_STYLE_PROPS = new Set<keyof ManualEditStyles>(['gap', 'flexDirection', 'justifyContent', 'alignItems']);

export function normalizeManualEditStyles(styles: Partial<ManualEditStyles>, { layoutEnabled }: { layoutEnabled: boolean }): NormalizeResult {
  const normalized: Partial<ManualEditStyles> = {};
  for (const [rawKey, rawValue] of Object.entries(styles) as Array<[keyof ManualEditStyles, string]>) {
    if (LAYOUT_STYLE_PROPS.has(rawKey) && !layoutEnabled) continue;
    const value = rawValue.trim();
    if (value === '') {
      normalized[rawKey] = '';
      continue;
    }
    if (PX_STYLE_PROPS.has(rawKey)) {
      const px = normalizeLengthValue(value, rawKey);
      if (!px) return { ok: false, error: `${styleLabel(rawKey)} must be a number, px, %, or supported auto value.` };
      normalized[rawKey] = px;
      continue;
    }
    if (COLOR_STYLE_PROPS.has(rawKey)) {
      const color = normalizeHexColor(value);
      if (!color) return { ok: false, error: `${styleLabel(rawKey)} must be a hex color.` };
      normalized[rawKey] = color;
      continue;
    }
    if (rawKey === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Opacity must be a number.' };
      normalized.opacity = String(Math.max(0, Math.min(1, n)));
      continue;
    }
    if (rawKey === 'lineHeight') {
      const lineHeight = normalizeLineHeightValue(value);
      if (!lineHeight) return { ok: false, error: 'Line height must be a positive number or px value.' };
      normalized.lineHeight = lineHeight;
      continue;
    }
    const options = SELECT_STYLE_OPTIONS[rawKey];
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${styleLabel(rawKey)} has an unsupported value.` };
      normalized[rawKey] = value;
      continue;
    }
    normalized[rawKey] = value;
  }
  return { ok: true, styles: normalized };
}

function normalizeLengthValue(value: string, key: keyof ManualEditStyles): string | null {
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${value}px`;
  if (/^-?\d+(\.\d+)?px$/i.test(value)) return value.toLowerCase();
  if (/^-?\d+(\.\d+)?%$/i.test(value) && ['width', 'height', 'minHeight'].includes(key)) return value.toLowerCase();
  if (value.toLowerCase() === 'auto' && ['marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'margin'].includes(key)) return 'auto';
  return null;
}

function normalizeLineHeightValue(value: string): string | null {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? String(n) : null;
  }
  if (/^\d+(\.\d+)?px$/i.test(value)) {
    const n = Number(value.slice(0, -2));
    return n > 0 ? value.toLowerCase() : null;
  }
  return null;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!,
      g = trimmed[2]!,
      b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function styleLabel(key: keyof ManualEditStyles): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

// Which style keys have project-token reference values, and the suggestion prop
// the daemon indexes them under.
export const STYLE_TO_SUGGESTION_PROP: Partial<Record<keyof ManualEditStyles, ProjectDesignTokenSuggestionProp>> = {
  color: 'color',
  backgroundColor: 'backgroundColor',
  borderColor: 'borderColor',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  width: 'width',
  height: 'height',
  gap: 'gap',
  borderRadius: 'borderRadius',
  borderTopWidth: 'borderWidth',
  padding: 'padding',
  paddingTop: 'padding',
  paddingRight: 'padding',
  paddingBottom: 'padding',
  paddingLeft: 'padding',
  margin: 'margin',
  marginTop: 'margin',
  marginRight: 'margin',
  marginBottom: 'margin',
  marginLeft: 'margin',
};

// Applying a suggestion writes back to a real style key.
export const SUGGESTION_TO_STYLE_KEY: Record<ProjectDesignTokenSuggestionProp, keyof ManualEditStyles> = {
  color: 'color',
  backgroundColor: 'backgroundColor',
  borderColor: 'borderColor',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  width: 'width',
  height: 'height',
  gap: 'gap',
  padding: 'padding',
  margin: 'margin',
  borderRadius: 'borderRadius',
  borderWidth: 'borderTopWidth',
};

export const COLOR_SUGGESTION_PROPS: ReadonlySet<ProjectDesignTokenSuggestionProp> = new Set(['color', 'backgroundColor', 'borderColor']);

export type DropdownOption = string | { value: string; label: string };

export function layoutDirectionOptions(t: TranslateFn): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'row', label: t('manualEdit.directionRow') },
    { value: 'row-reverse', label: t('manualEdit.directionRowReverse') },
    { value: 'column', label: t('manualEdit.directionColumn') },
    { value: 'column-reverse', label: t('manualEdit.directionColumnReverse') },
  ];
}

export function justifyOptions(t: TranslateFn): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'flex-start', label: t('manualEdit.justifyStart') },
    { value: 'center', label: t('manualEdit.justifyCenter') },
    { value: 'flex-end', label: t('manualEdit.justifyEnd') },
    { value: 'space-between', label: t('manualEdit.justifyBetween') },
    { value: 'space-around', label: t('manualEdit.justifyAround') },
    { value: 'space-evenly', label: t('manualEdit.justifyEvenly') },
  ];
}

export function textAlignOptions(t: TranslateFn): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'left', label: t('manualEdit.textAlignLeft') },
    { value: 'center', label: t('manualEdit.textAlignCenter') },
    { value: 'right', label: t('manualEdit.textAlignRight') },
  ];
}

export function itemAlignOptions(t: TranslateFn): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'flex-start', label: t('manualEdit.alignStart') },
    { value: 'center', label: t('manualEdit.alignCenter') },
    { value: 'flex-end', label: t('manualEdit.alignEnd') },
    { value: 'stretch', label: t('manualEdit.alignStretch') },
    { value: 'baseline', label: t('manualEdit.alignBaseline') },
  ];
}

export function borderStyleOptions(t: TranslateFn): DropdownOption[] {
  return [
    { value: '', label: '–' },
    { value: 'solid', label: t('manualEdit.borderStyleSolid') },
    { value: 'dashed', label: t('manualEdit.borderStyleDashed') },
    { value: 'dotted', label: t('manualEdit.borderStyleDotted') },
    { value: 'double', label: t('manualEdit.borderStyleDouble') },
    { value: 'none', label: t('manualEdit.borderStyleNone') },
  ];
}

export function dropdownOptionValue(option: DropdownOption): string {
  return typeof option === 'string' ? option : option.value;
}

export function dropdownOptionLabel(option: DropdownOption, placeholder?: string): string {
  if (typeof option === 'string') return option || (placeholder ?? '–');
  return option.label;
}

export function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const direct = FONT_OPTS.find((option) => option.value === trimmed);
  if (direct) return direct.value;
  const families = parseFontFamilies(trimmed);
  const primaryFamily = families[0];
  const match = FONT_OPTS.find((option) => {
    if (!option.value) return false;
    const optionFamilies = parseFontFamilies(option.value);
    return optionFamilies[0] === primaryFamily;
  });
  return match?.value ?? trimmed;
}

export function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value;
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
}

export function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match?.[1] ?? value;
}

export function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

export function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)));
  return decimals > 0 ? value.toFixed(decimals).replace(/\.?0+$/, '') : String(Math.round(value));
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/);
  return match?.[1]?.length ?? 0;
}

export type QuadSide = 't' | 'r' | 'b' | 'l';

export function sideToProp(base: 'padding' | 'margin', side: QuadSide): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles;
}
function sideUpper(side: QuadSide): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left';
}

export function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!,
        g = trimmed[2]!,
        b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`;
  }
  return '#000000';
}

export function manualEditPatchSummary(patch: ManualEditPatch): string {
  if (patch.kind === 'set-full-source') return JSON.stringify({ kind: patch.kind, bytes: patch.source.length });
  if (patch.kind === 'set-outer-html') return JSON.stringify({ id: patch.id, kind: patch.kind, bytes: patch.html.length });
  return JSON.stringify(patch);
}
