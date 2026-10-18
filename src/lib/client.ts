// Browser-side session + API helpers.
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  // ponytail: no captcha, so anonymous sign-ups can be spammed. Upgrade: Turnstile widget on first load +
  // NEXT_PUBLIC_TURNSTILE_SITE_KEY, pass options.captchaToken here, then enable captcha in Supabase Auth.
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return anon.session!;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = await ensureSession();
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText);
  return json as T;
}

/** Upgrade the anonymous user to X so their runs carry over. */
export async function signInWithX() {
  await ensureSession();
  const { error } = await supabase.auth.linkIdentity({ provider: "x", options: { redirectTo: location.href } });
  if (error) throw error;
}

/**
 * After the OAuth redirect: if this X account already belongs to another user (e.g. linked on another
 * device), sign in as that user instead. This device's anonymous runs stay with the anonymous user.
 */
export async function recoverFromLinkConflict() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search);
  if (params.get("error_code") !== "identity_already_exists") return;
  history.replaceState(null, "", location.pathname);
  await supabase.auth.signInWithOAuth({ provider: "x", options: { redirectTo: location.origin + location.pathname } });
}
