// The portal's API: one fetch per call to the router, under the personal link.
// No sessions and no cookies: the code in the path is the key. A refused call
// throws an ApiError carrying the status and, for a plain-HTTP visitor, the
// HTTPS twin of the link.

import { base } from './state';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The HTTPS twin of this link, when the answer was "not over plain HTTP". */
    public httpsUrl?: string,
  ) {
    super(message);
  }
}

export async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  // Any shape: an error answer may be empty or not JSON at all.
  let data: { error?: string; https_url?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.https_url || undefined);
  return data as T;
}

/** The link stopped working (code regenerated, person removed). */
export const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 401);
