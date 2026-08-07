import "server-only";
import { cache } from "react";
import { ServerApiError, serverApi } from "./server-api";

export type CurrentUser = {
  id: string;
  displayName: string;
};

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    return (await serverApi<{ user: CurrentUser }>("/auth/me")).user;
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 401) return null;
    throw error;
  }
});
