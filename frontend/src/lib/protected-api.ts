import { notFound, redirect } from "next/navigation";
import { safeReturnTo } from "./return-to";
import { ServerApiError, serverApi } from "./server-api";

export async function protectedApi<T>(path: string, returnTo?: string): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 401) {
      redirect(returnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}` : "/login");
    }
    if (error instanceof ServerApiError && error.status === 404) notFound();
    throw error;
  }
}
