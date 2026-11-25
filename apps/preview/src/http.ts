// Stand-in for the platform's apiCenter Axios instance.
//
// In the host system, pass the real apiCenter instance to
// `createDesignPreview({ http })` instead: every request the preview library
// makes (daemon file API, static manifests, comments) then goes through the
// platform's interceptors (auth headers, gateway prefix, error reporting).
//
// The library reads responses fetch-style (it checks `status` itself and asks
// for text / blob bodies explicitly), so interceptors must hand its responses
// back untouched; they are tagged `config.odPreview === true` — see README.md.
import axios from 'axios';

export const apiCenter = axios.create({
  // The preview talks to same-origin endpoints (`/api/*` proxied to the Open
  // Design daemon, static project folders); no base URL needed here.
  timeout: 0,
  // fetch adapter first: supports `fetchOptions.cache` (no-store reads) and
  // streams binary bodies straight into Blobs.
  adapter: ['fetch', 'xhr'],
});

// A typical platform response interceptor (unwrap `{ code, data }`, reject
// business errors) — the preview's own requests pass through untouched:
apiCenter.interceptors.response.use((response) => {
  // Preview requests: raw response — the library checks `status` itself.
  if (response.config.odPreview) return response;
  // Platform requests: unwrap a `{ code, data, message }` envelope.
  const body = response.data as { code?: number; data?: unknown; message?: string } | null;
  if (body && typeof body === 'object' && 'code' in body) {
    if (body.code !== 0) return Promise.reject(new Error(body.message ?? `code ${body.code}`));
    return { ...response, data: body.data };
  }
  return response;
});
// Request interceptors (auth headers, gateway prefix) apply to the preview
// too; keep custom headers off cross-origin daemon requests unless the
// daemon's CORS policy allows them (they trigger a preflight).
