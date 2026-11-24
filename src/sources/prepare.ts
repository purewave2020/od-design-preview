import { inlineHtmlAssets } from './inline-assets';
import type { PreparedHtml, PreviewSource } from './types';

/**
 * HTML ready for `buildSrcdoc`: HTTP sources keep their bytes and get a
 * `<base href>`; disk-only sources get their assets inlined. Files an HTTP
 * source only holds in the browser (edits to the bundled demo, uploaded
 * images) are inlined too, since the sandboxed frame cannot fetch them.
 */
export async function prepareHtmlForPreview(source: PreviewSource, name: string, html: string): Promise<PreparedHtml> {
  const baseHref = source.baseHrefFor(name);
  if (baseHref) {
    const overlay = source.overlayPaths?.();
    if (overlay && overlay.size > 0) {
      const inlined = await inlineHtmlAssets(html, name, (path) => (overlay.has(path) ? source.readBlob(path) : Promise.resolve(null)));
      return { html: inlined, baseHref };
    }
    return { html, baseHref };
  }
  return { html: await inlineHtmlAssets(html, name, (path) => source.readBlob(path)) };
}

/** Fully self-contained HTML (every relative asset inlined) for exports. */
export function selfContainedHtml(source: PreviewSource, name: string, html: string): Promise<string> {
  return inlineHtmlAssets(html, name, (path) => source.readBlob(path));
}
