// Turns upstream apps/web/src/components/Icon.tsx (a React switch over JSX
// <svg> glyphs) into a framework-free data module — the `IconName` union, the
// Remix name map and every hand-drawn glyph as `[tag, attrs, children]`
// tuples — rendered by the Vue component `Icon.vue`. Used by
// scripts/sync-upstream.mjs; run directly to convert one file:
//
//   node scripts/lib/convert-icon.mjs <Icon.tsx> <out Icon.ts>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// React SVG prop name → DOM attribute name.
const ATTR_RENAMES = { className: 'class', htmlFor: 'for', xlinkHref: 'xlink:href', xmlnsXlink: 'xmlns:xlink' };
const KEEP_CAMEL = new Set(['viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'markerWidth', 'markerHeight', 'refX', 'refY', 'textLength', 'lengthAdjust', 'pathLength']);

function attrName(name) {
  if (ATTR_RENAMES[name]) return ATTR_RENAMES[name];
  if (KEEP_CAMEL.has(name) || name.includes('-')) return name;
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function literalValue(node, sourceFile) {
  if (!node) return true; // boolean attribute
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) {
    const expr = node.expression;
    if (!expr) return undefined;
    if (ts.isNumericLiteral(expr)) return Number(expr.text);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) return -Number(expr.operand.text);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isTemplateExpression(expr)) return { template: expr.getText(sourceFile) };
    return { expression: expr.getText(sourceFile) };
  }
  return { expression: node.getText(sourceFile) };
}

function convertElement(node, sourceFile) {
  const opening = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
  const tag = opening.tagName.getText(sourceFile);
  const attrs = {};
  let spreadCommon = false;
  let extraClass;
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(prop)) {
      if (prop.expression.getText(sourceFile) === 'common') spreadCommon = true;
      else throw new Error(`Unsupported spread {...${prop.expression.getText(sourceFile)}} in <${tag}>`);
      continue;
    }
    const name = prop.name.getText(sourceFile);
    const value = literalValue(prop.initializer, sourceFile);
    if (value === undefined) continue;
    if (name === 'className' && typeof value === 'object' && value.template) {
      // `od-icon icon-spin${strokeClassName ? …}` → the static extra classes.
      const head = value.template.replace(/^`/, '').split('${')[0];
      extraClass = head.split(/\s+/).filter((c) => c && c !== 'od-icon').join(' ') || undefined;
      continue;
    }
    if (typeof value === 'object') throw new Error(`Unsupported expression ${name}=${JSON.stringify(value)} in <${tag}>`);
    attrs[attrName(name)] = value;
  }
  const children = [];
  if (!ts.isJsxSelfClosingElement(node)) {
    for (const child of node.children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) children.push(convertElement(child, sourceFile).node);
      else if (ts.isJsxText(child) && child.getText(sourceFile).trim()) throw new Error(`Unexpected text in <${tag}>`);
    }
  }
  const tuple = children.length ? [tag, attrs, children] : [tag, attrs];
  return { node: tuple, spreadCommon, extraClass };
}

function findJsxReturn(statements) {
  for (const statement of statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      let expr = statement.expression;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) return expr;
      if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
    }
    if (ts.isBlock(statement)) {
      const inner = findJsxReturn(statement.statements);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

export function convertIconSource(text, header = '') {
  const sourceFile = ts.createSourceFile('Icon.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let iconNameText = '';
  let remixMapText = '';
  const glyphs = [];
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'IconName') iconNameText = node.getText(sourceFile);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.name.getText(sourceFile) === 'REMIX_ICON') remixMapText = node.getText(sourceFile);
      }
    }
    if (ts.isSwitchStatement(node)) {
      let pending = [];
      for (const clause of node.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) continue;
        pending.push(clause.expression.text);
        const element = findJsxReturn(clause.statements);
        if (element === undefined) continue; // fall-through
        if (element) {
          const { node: tuple, spreadCommon, extraClass } = convertElement(element, sourceFile);
          for (const name of pending) glyphs.push({ name, tuple, spreadCommon, extraClass });
        }
        pending = [];
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!iconNameText) throw new Error('IconName type not found in Icon.tsx');
  if (!remixMapText) throw new Error('REMIX_ICON map not found in Icon.tsx');
  if (glyphs.length < 10) throw new Error(`Only ${glyphs.length} glyphs found in Icon.tsx`);

  const lines = [];
  lines.push(header || '// Generated from upstream apps/web/src/components/Icon.tsx by scripts/lib/convert-icon.mjs. Do not edit by hand.');
  lines.push('// The React switch of hand-drawn glyphs is stored as data; Icon.vue renders it.');
  lines.push('');
  lines.push(`export ${iconNameText.replace(/^export\s+/, '')}`);
  lines.push('');
  lines.push(remixMapText.replace(/^const /, 'export const '));
  lines.push('');
  lines.push('export type IconNode = [tag: string, attrs: Record<string, string | number | boolean>, children?: IconNode[]];');
  lines.push('');
  lines.push('export interface IconGlyph {');
  lines.push('  /** `<svg>` attributes set after the shared stroke attributes (`{...common}` upstream). */');
  lines.push('  svg: Record<string, string | number | boolean>;');
  lines.push('  /** Whether the glyph spreads the shared stroke attributes. */');
  lines.push('  common: boolean;');
  lines.push('  /** Extra class next to `od-icon` (e.g. `icon-spin`). */');
  lines.push('  className?: string;');
  lines.push('  children: IconNode[];');
  lines.push('}');
  lines.push('');
  lines.push('export const ICON_GLYPHS: Partial<Record<IconName, IconGlyph>> = {');
  for (const glyph of glyphs) {
    const [, svgAttrs, children = []] = glyph.tuple;
    const entry = { svg: svgAttrs, common: glyph.spreadCommon, ...(glyph.extraClass ? { className: glyph.extraClass } : {}), children };
    lines.push(`  ${JSON.stringify(glyph.name)}: ${JSON.stringify(entry)},`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node scripts/lib/convert-icon.mjs <Icon.tsx> <out Icon.ts>');
    process.exit(2);
  }
  const out = convertIconSource(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, out);
  console.log(`wrote ${output}`);
}
