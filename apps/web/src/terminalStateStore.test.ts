import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

type TerminalStateStoreModule = typeof import("./terminalStateStore");

let selectThreadTerminalState: TerminalStateStoreModule["selectThreadTerminalState"];
let useTerminalStateStore: TerminalStateStoreModule["useTerminalStateStore"];

function installMemoryLocalStorage(): void {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

describe("terminalStateStore actions", () => {
  beforeEach(async () => {
    vi.resetModules();
    installMemoryLocalStorage();
    const module = await import("./terminalStateStore");
    selectThreadTerminalState = module.selectThreadTerminalState;
    useTerminalStateStore = module.useTerminalStateStore;
    useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  });

  it("returns a closed default terminal state for unknown threads", () => {
    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState).toEqual({
      terminalOpen: false,
      terminalHeight: 280,
      terminalIds: ["default"],
      runningTerminalIds: [],
      activeTerminalId: "default",
      terminalGroups: [{ id: "group-default", terminalIds: ["default"] }],
      activeTerminalGroupId: "group-default",
      previewOpen: false,
      previewUrl: null,
    });
  });

  it("opens and splits terminals into the active group", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalOpen(THREAD_ID, true);
    store.splitTerminal(THREAD_ID, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2"] },
    ]);
  });

  it("creates new terminals in a separate group", () => {
    useTerminalStateStore.getState().newTerminal(THREAD_ID, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.activeTerminalGroupId).toBe("group-terminal-2");
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default"] },
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("tracks and clears terminal subprocess activity", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.setTerminalActivity(THREAD_ID, "terminal-2", true);
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .runningTerminalIds,
    ).toEqual(["terminal-2"]);

    store.setTerminalActivity(THREAD_ID, "terminal-2", false);
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .runningTerminalIds,
    ).toEqual([]);
  });

  it("stores preview browser state per thread", () => {
    const store = useTerminalStateStore.getState();
    store.openPreview(THREAD_ID, "localhost:4173");

    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        THREAD_ID,
      ),
    ).toMatchObject({
      terminalOpen: false,
      previewOpen: true,
      previewUrl: "http://localhost:4173/",
    });
  });

  it("keeps preview state available when closing the final terminal session", () => {
    const store = useTerminalStateStore.getState();
    store.openPreview(THREAD_ID, "localhost:4173");
    store.closeTerminal(THREAD_ID, "default");

    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        THREAD_ID,
      ),
    ).toMatchObject({
      terminalOpen: false,
      previewOpen: true,
      previewUrl: "http://localhost:4173/",
    });

    store.closePreview(THREAD_ID);
    expect(
      selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        THREAD_ID,
      ),
    ).toMatchObject({
      terminalOpen: false,
      previewOpen: false,
      previewUrl: "http://localhost:4173/",
    });
  });

  it("resets to default and clears persisted entry when closing the last terminal", () => {
    const store = useTerminalStateStore.getState();
    store.closeTerminal(THREAD_ID, "default");

    expect(useTerminalStateStore.getState().terminalStateByThreadId[THREAD_ID]).toBeUndefined();
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .terminalIds,
    ).toEqual(["default"]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.splitTerminal(THREAD_ID, "terminal-3");
    store.closeTerminal(THREAD_ID, "terminal-3");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.terminalGroups).toEqual([
      { id: "group-default", terminalIds: ["default", "terminal-2"] },
    ]);
  });
});
