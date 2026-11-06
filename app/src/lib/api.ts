import { API_URL } from "./config";

/** Calls the Bull Street API. Throws with the server's error message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Request failed (${r.status})`), { code: j.code, status: r.status });
  return j as T;
}
