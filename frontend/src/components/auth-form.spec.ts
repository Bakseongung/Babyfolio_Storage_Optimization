// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clientApiMock, replaceDocumentMock } = vi.hoisted(() => ({
  clientApiMock: vi.fn(),
  replaceDocumentMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({ clientApi: clientApiMock }));
vi.mock("@/lib/document-navigation", () => ({ replaceDocument: replaceDocumentMock }));

import { AuthForm } from "./auth-form";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clientApiMock.mockReset().mockResolvedValue({ user: { displayName: "김민태" } });
  replaceDocumentMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("authentication navigation", () => {
  it("returns to an invitation after login", async () => {
    await act(async () => root.render(createElement(AuthForm, {
      mode: "login",
      returnTo: "/invite/invite-token"
    })));
    const email = container.querySelector<HTMLInputElement>('input[name="email"]')!;
    const password = container.querySelector<HTMLInputElement>('input[name="password"]')!;
    email.value = "user@example.com";
    password.value = "password";

    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(clientApiMock).toHaveBeenCalledWith("/auth/login", expect.objectContaining({ method: "POST" }));
    expect(replaceDocumentMock).toHaveBeenCalledWith("/invite/invite-token");
  });
});
