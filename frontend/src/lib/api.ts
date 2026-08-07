export async function clientApi<T>(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
  let response: Response;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  try {
    response = await fetch(`/api${path}`, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  if (response.status === 204) return undefined as T;

  let body: { message?: string; code?: string };
  try {
    body = await response.json() as { message?: string; code?: string };
  } catch {
    if (response.ok) {
      throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
    body = {};
  }
  if (!response.ok) {
    const error = new Error(body.message ?? "요청을 처리하지 못했습니다.");
    (error as Error & { code?: string }).code = body.code;
    throw error;
  }
  return body as T;
}
