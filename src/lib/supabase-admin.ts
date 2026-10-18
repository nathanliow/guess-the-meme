import { createClient, type User } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Server only.
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Resolve the caller from `Authorization: Bearer <access_token>`. */
export async function getUser(req: Request): Promise<User> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "unauthorized");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  return data.user;
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await getUser(req);
  const ids = (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim());
  if (!ids.includes(user.id)) throw new HttpError(403, "forbidden");
  return user;
}

/** Wrap a route handler so HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "internal" }, { status: 500 });
    }
  };
}

/** Call a game SQL function; maps `not_found` raises to 404. */
export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    if (error.message.includes("not_found")) throw new HttpError(404, "not_found");
    throw error;
  }
  return data as T;
}
