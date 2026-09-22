import type { Session } from "@supabase/supabase-js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message_he?: string } } | null;
    throw new ApiRequestError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message_he ?? "הפעולה נכשלה.");
  }
  return (await response.json()) as T;
}
