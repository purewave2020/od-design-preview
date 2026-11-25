// Same sandbox as upstream HTML_PREVIEW_SANDBOX: scripts run, but on an
// opaque origin with no access to this app, its storage or cookies.
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-downloads';

/** Export formats of the HTML viewer's Export menu. */
export type ExportFormat = 'pdf' | 'image' | 'zip' | 'html';
