// Vendored verbatim from nexu-io/open-design@5fdcc3db1e31
// upstream: packages/components/src/class-names.ts (Apache-2.0). Do not edit by hand; run `npm run sync:upstream`.
export function joinClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ') || undefined;
}
