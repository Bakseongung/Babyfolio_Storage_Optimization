import "server-only";
import { cookies } from "next/headers";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

export class ServerApiError extends Error {
  constructor(readonly status: number) {
    super(`API_${status}`);
  }
}

export async function serverApi<T>(path: string): Promise<T> {
  const cookie = (await cookies()).toString();

  try {
    const response = await fetch(`${apiOrigin}/api${path}`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new ServerApiError(response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ServerApiError) throw error;
    throw new ServerApiError(503);
  }
}
