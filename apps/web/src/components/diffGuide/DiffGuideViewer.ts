import type {
  CodeViewDiffItem,
  CodeViewLineSelection,
  CodeViewScrollTarget,
  FileDiffOptions,
  SelectedLineRange,
  VirtualizedFileDiff,
} from "@pierre/diffs";
import { DIFFS_TAG_NAME } from "@pierre/diffs";

/** Callbacks the viewer hands every file the item they belong to, as CodeView does. */
const SHARED_CALLBACK_KEYS = [
  "onGutterUtilityClick",
  "onLineClick",
  "onLineNumberClick",
  "onLineEnter",
  "onLineLeave",
  "onTokenClick",
  "onTokenEnter",
  "onTokenLeave",
] as const;
const SELECTION_CALLBACK_KEYS = [
  "onLineSelected",
  "onLineSelectionStart",
  "onLineSelectionChange",
  "onLineSelectionEnd",
] as const;

type HostCallback = (...args: unknown[]) => unknown;

/** What a surface needs to reveal files, whichever viewer draws them. */
export interface DiffViewerHandle {
  getInstance(): object | undefined;
  getItem(id: string): object | undefined;
  scrollTo(target: CodeViewScrollTarget): void;
  /** Moves on past a file that just folded; only the guide document does. */
  revealAfterFile?(id: string): void;
}

interface MountedFile<L> {
  readonly element: HTMLElement;
  readonly instance: VirtualizedFileDiff<L>;
}

/**
 * The imperative side of a guide document: it knows where every file sits in the scroll container,
 * so it can reveal files and lines, and it gives each file's
 * callbacks the item they came from, so a surface's CodeView options work unchanged.
 */
export class DiffGuideViewer<L> implements DiffViewerHandle {
  #root: HTMLElement | undefined;
  #items: ReadonlyArray<CodeViewDiffItem<L>> = [];
  #files = new Map<string, MountedFile<L>>();
  #options: Readonly<Record<string, unknown>> = {};
  #selection: CodeViewLineSelection | null = null;
  #onSelectedLinesChange: ((selection: CodeViewLineSelection | null) => void) | undefined;

  attach(root: HTMLElement) {
    this.#root = root;
  }

  detach() {
    this.#root = undefined;
  }

  /** The latest props; read when a file's callback fires, so files never re-render for them. */
  update(input: {
    readonly options: Readonly<Record<string, unknown>>;
    readonly selection: CodeViewLineSelection | null;
    readonly onSelectedLinesChange: ((selection: CodeViewLineSelection | null) => void) | undefined;
  }) {
    this.#options = input.options;
    this.#selection = input.selection;
    this.#onSelectedLinesChange = input.onSelectedLinesChange;
  }

  setItems(items: ReadonlyArray<CodeViewDiffItem<L>>) {
    this.#items = items;
  }

  registerFile(id: string, element: HTMLElement, instance: VirtualizedFileDiff<L>) {
    this.#files.set(id, { element, instance });
  }

  unregisterFile(id: string, instance: VirtualizedFileDiff<L>) {
    if (this.#files.get(id)?.instance === instance) this.#files.delete(id);
  }

  /**
   * The callbacks a file's renderer gets: the surface's own (those `options` has), called with the
   * file's item appended. They read the latest options when they fire.
   */
  callbacksFor(id: string, options: object): Partial<FileDiffOptions<L, undefined>> {
    const callbacks: Record<string, HostCallback> = {};
    for (const key of SHARED_CALLBACK_KEYS) {
      if (!(key in options)) continue;
      callbacks[key] = (...args) => this.#call(key, id, args);
    }
    for (const key of SELECTION_CALLBACK_KEYS) {
      callbacks[key] = (range) => {
        const selection = range == null ? null : { id, range: range as SelectedLineRange };
        if (selection !== null || this.#selection?.id === id) {
          this.#onSelectedLinesChange?.(selection);
        }
        return this.#call(key, id, [range]);
      };
    }
    return callbacks as Partial<FileDiffOptions<L, undefined>>;
  }

  #call(key: string, id: string, args: unknown[]) {
    const callback = this.#options[key] as HostCallback | undefined;
    const item = this.#items.find((candidate) => candidate.id === id);
    const file = this.#files.get(id);
    if (callback === undefined || item === undefined) return undefined;
    return callback(...args, { type: "diff", item, instance: file?.instance });
  }

  getItem(id: string) {
    return this.#items.find((candidate) => candidate.id === id);
  }

  getInstance() {
    return this.#root === undefined ? undefined : this;
  }

  scrollTo(target: CodeViewScrollTarget) {
    const root = this.#root;
    if (root === undefined) return;
    let top: number | undefined;
    let height = 0;
    if (target.type === "position") top = target.position;
    else if (target.type === "item") top = this.#fileTop(target.id);
    else if (target.type === "line") {
      const line = this.#lineBox(target.id, target.lineNumber, target.side ?? "additions");
      top = line?.top;
      height = line?.height ?? 0;
    }
    if (top === undefined) return;
    const align = "align" in target ? (target.align ?? "start") : "start";
    const offset = "offset" in target ? (target.offset ?? 0) : 0;
    const aligned =
      align === "center"
        ? top + height / 2 - root.clientHeight / 2
        : align === "end"
          ? top + height - root.clientHeight
          : top;
    root.scrollTo({ top: Math.max(0, aligned + offset) });
  }

  /**
   * Once a file folds as it is marked viewed, brings what the reader goes on to next to the top:
   * the next file, or the next section when the file closed its own. Without this the fold pulls
   * everything below up past the viewport and the reader is left deep inside a later file.
   */
  revealAfterFile(id: string) {
    const root = this.#root;
    const file = this.#files.get(id);
    if (root === undefined || file === undefined) return;
    // Two frames: the fold renders in a layout effect, then the browser lays it out.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const files = Array.from(root.querySelectorAll(DIFFS_TAG_NAME));
        const next = files[files.indexOf(file.element) + 1];
        if (next === undefined) {
          file.element.scrollIntoView({ block: "nearest" });
          return;
        }
        const section = next.closest("section");
        const target =
          section !== null && section !== file.element.closest("section") ? section : next;
        target.scrollIntoView({ block: "start" });
      }),
    );
  }

  #fileTop(id: string): number | undefined {
    const root = this.#root;
    const file = this.#files.get(id);
    if (root === undefined || file === undefined) return undefined;
    return (
      root.scrollTop + file.element.getBoundingClientRect().top - root.getBoundingClientRect().top
    );
  }

  #lineBox(id: string, lineNumber: number, side: "additions" | "deletions") {
    const fileTop = this.#fileTop(id);
    const position = this.#files.get(id)?.instance.getLinePosition(lineNumber, side);
    if (fileTop === undefined || position === undefined) return undefined;
    return { top: fileTop + position.top, height: position.height };
  }
}
