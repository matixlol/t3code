import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";

const { readLocalApiMock } = vi.hoisted(() => ({
  readLocalApiMock: vi.fn(() => ({
    shell: { openExternal: vi.fn(async () => undefined) },
  })),
}));

vi.mock("~/env", () => ({
  isElectron: true,
}));

vi.mock("~/localApi", () => ({
  readLocalApi: readLocalApiMock,
}));

import PreviewBrowserPanel from "./PreviewBrowserPanel";

type WebviewDouble = {
  element: HTMLElement & {
    reload: ReturnType<typeof vi.fn>;
    stop?: ReturnType<typeof vi.fn>;
    src: string;
  };
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  isDomReady: boolean;
};

function Harness({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);

  return <PreviewBrowserPanel url={url} onNavigate={setUrl} />;
}

describe("PreviewBrowserPanel", () => {
  let createElementSpy: { mockRestore: () => void };
  let webviews: WebviewDouble[];
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    webviews = [];

    createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, options) => {
        const element = options
          ? originalCreateElement(tagName, options)
          : originalCreateElement(tagName);

        if (tagName.toLowerCase() !== "webview") {
          return element;
        }

        const webview = element as WebviewDouble["element"];
        const entry: WebviewDouble = {
          element: webview,
          reload: vi.fn(),
          stop: vi.fn(() => {
            if (!entry.isDomReady) {
              throw new Error(
                "The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.",
              );
            }
          }),
          isDomReady: false,
        };

        webview.reload = entry.reload;
        webview.stop = entry.stop;
        webview.src = "";
        webview.addEventListener("dom-ready", () => {
          entry.isDomReady = true;
        });
        webviews.push(entry);

        return webview;
      });
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    readLocalApiMock.mockClear();
    document.body.innerHTML = "";
  });

  it("does not stop the webview during unmount before dom-ready", async () => {
    const screen = await render(
      <PreviewBrowserPanel url="http://127.0.0.1:3000" onNavigate={vi.fn()} />,
    );

    expect(webviews).toHaveLength(1);

    await expect(screen.unmount()).resolves.toBeUndefined();
    expect(webviews[0]?.stop).not.toHaveBeenCalled();
  });

  it("does not stop the webview during unmount after dom-ready", async () => {
    const screen = await render(
      <PreviewBrowserPanel url="http://127.0.0.1:3000" onNavigate={vi.fn()} />,
    );

    const webview = webviews[0];
    expect(webview).toBeDefined();
    webview?.element.dispatchEvent(new Event("dom-ready"));

    await expect(screen.unmount()).resolves.toBeUndefined();
    expect(webview?.stop).not.toHaveBeenCalled();
  });

  it("reloads the webview only after dom-ready", async () => {
    const screen = await render(
      <PreviewBrowserPanel url="http://127.0.0.1:3000" onNavigate={vi.fn()} />,
    );

    try {
      const webview = webviews[0];
      expect(webview).toBeDefined();

      await page.getByRole("button", { name: "Reload preview" }).click();
      expect(webview?.reload).not.toHaveBeenCalled();

      webview?.element.dispatchEvent(new Event("dom-ready"));
      await page.getByRole("button", { name: "Reload preview" }).click();
      expect(webview?.reload).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
    }
  });

  it("updates the url bar when the preview navigates", async () => {
    const screen = await render(<Harness initialUrl="http://127.0.0.1:3000" />);

    try {
      const webview = webviews[0];
      expect(webview).toBeDefined();

      webview?.element.dispatchEvent(
        Object.assign(new Event("did-navigate"), {
          url: "https://example.com/docs",
          isMainFrame: true,
        }),
      );

      await expect
        .element(page.getByLabelText("Preview URL"))
        .toHaveValue("https://example.com/docs");
    } finally {
      await screen.unmount();
    }
  });
});
