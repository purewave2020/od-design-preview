// Hand-written adapter (not vendored). Replaces `@open-design/host`, the
// Electron desktop bridge. In a plain browser there is never a host, so every
// call reports "unavailable" and the vendored export helpers take their
// pure-web paths (Blob downloads, jsPDF capture, print popup).

type HostFailure = { ok: false; error: string };

export type HostDownloadResult = {
  url: string;
  state: 'completed' | 'cancelled' | 'interrupted';
};

export function isOpenDesignHostAvailable(): boolean {
  return false;
}

export async function captureHostPage(
  _options?: { clip?: { x: number; y: number; width: number; height: number } },
): Promise<{ ok: true; dataUrl: string; w: number; h: number } | HostFailure> {
  return { ok: false, error: 'OpenDesign host is not available' };
}

export async function printHostPdf(
  _html: string,
  _nonce?: string,
  _options?: { deck?: boolean },
): Promise<{ ok: true } | HostFailure> {
  return { ok: false, error: 'OpenDesign host is not available' };
}

export function subscribeHostDownloads(
  _listener: (result: HostDownloadResult) => void,
): (() => void) | null {
  return null;
}
