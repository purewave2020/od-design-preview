// HTTP layer of the component library. Every request the preview makes
// (daemon project API, comment API, static project manifests and files) goes
// through one Axios instance, so a host platform can hand in its own client
// (e.g. the platform `apiCenter` instance with auth headers / base URL) via
// `setPreviewHttpClient()` or `createDesignPreview({ http })`.
//
// The default client uses Axios' Fetch adapter, which keeps the `cache`
// hints ('no-store' for listings and fresh reads) the original fetch() calls
// relied on; with an XHR-based host client the hint is simply ignored.
//
// Contract for an injected client: it must resolve with the raw AxiosResponse
// (`{ status, data, headers }`). Every request made here carries
// `config.odPreview === true`, so a platform response interceptor that unwraps
// `response.data` or rejects business error codes can let these through:
//
//   apiCenter.interceptors.response.use((res) => (res.config.odPreview ? res : unwrap(res)));
//
// Alternatively give the preview a dedicated instance.
import axios, { type AxiosInstance, type AxiosRequestConfig, type Method } from 'axios';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Set on every request of @od-design/preview (see the contract above). */
    odPreview?: boolean;
  }
}

const defaultClient: AxiosInstance = axios.create({ adapter: ['fetch', 'xhr'] });
let client: AxiosInstance = defaultClient;

/** Route the preview's HTTP traffic through a host-provided Axios instance (null → default). */
export function setPreviewHttpClient(next: AxiosInstance | null | undefined): void {
  client = next ?? defaultClient;
}

export function getPreviewHttpClient(): AxiosInstance {
  return client;
}

export interface PreviewHttpRequest {
  url: string;
  method?: Method;
  /** JSON body (objects are serialised by Axios). */
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Fetch cache mode — honoured by the Fetch adapter. */
  cache?: RequestCache;
  responseType?: 'json' | 'text' | 'blob';
}

export interface PreviewHttpResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

const identity = (data: unknown) => data;

/**
 * Fetch-like request: resolves for every HTTP status (check `ok`), rejects
 * only on network failure / abort — the semantics the sources were written
 * against.
 */
export async function httpRequest<T = unknown>(request: PreviewHttpRequest): Promise<PreviewHttpResponse<T>> {
  const responseType = request.responseType ?? 'json';
  const config: AxiosRequestConfig = {
    url: request.url,
    method: request.method ?? 'GET',
    data: request.data,
    headers: request.headers,
    signal: request.signal,
    responseType,
    validateStatus: () => true,
    odPreview: true,
    ...(request.cache ? { fetchOptions: { cache: request.cache } } : {}),
    // Text and binary bodies are returned exactly as received.
    ...(responseType === 'json' ? {} : { transformResponse: [identity] }),
  };
  const response = await client.request<T>(config);
  return { ok: response.status >= 200 && response.status < 300, status: response.status, data: response.data };
}

/** GET a JSON document; throws `<what> failed (<status>)` on a non-2xx answer. */
export async function getJson<T>(url: string, what: string, init?: Omit<PreviewHttpRequest, 'url' | 'responseType'>): Promise<T> {
  const resp = await httpRequest<T>({ ...init, url, responseType: 'json' });
  if (!resp.ok) throw new Error(`${what} failed (${resp.status})`);
  return resp.data;
}
