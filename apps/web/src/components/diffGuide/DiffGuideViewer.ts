import type {
  CodeViewDiffItem,
  CodeViewLineSelection,
  CodeViewScrollTarget,
  FileDiffOptions,
  SelectedLineRange,
  VirtualizedFileDiff,
} from "@pierre/diffs";
import { DIFFS_TAG_NAME } from "@pierre/diffs";
import {
  CodeViewSearch,
  type CodeViewSearchHost,
  type CodeViewSearchMatch,
} from "@pierre/diffs/components/CodeViewSearch";

/** Room the find panel covers at the top of the viewport; matches under it get scrolled clear. */
const SEARCH_PANEL_RESERVED_HEIGHT = 48;

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
 * so it can reveal files and lines and host CodeView's find panel, and it gives each file's
 * callbacks the item they came from, so a surface's CodeView options work unchanged.
 */
export class DiffGuideViewer<L> implements CodeViewSearchHost<L>, DiffViewerHandle {
  readonly search = new CodeViewSearch<L>(this);
  #root: HTMLElement | undefined;
  #items: ReadonlyArray<CodeViewDiffItem<L>> = [];
  #partialIds = new Set<string>();
  #files = new Map<string, MountedFile<L>>();
  #options: Readonly<Record<string, unknown>> = {};
  #selection: CodeViewLineSelection | null = null;
  #onSelectedLinesChange: ((selection: CodeViewLineSelection | null) => void) | undefined;
  #onRevealSearchMatch: ((item: CodeViewDiffItem<L>) => void) | undefined;
  #pendingReveal: CodeViewSearchMatch | undefined;
  #repaintFrame = 0;

  attach(root: HTMLElement) {
    this.#root = root;
    root.addEventListener("keydown", this.search.handleKeyDown);
  }

  detach() {
    this.#root?.removeEventListener("keydown", this.search.handleKeyDown);
    this.search.cleanUp();
    cancelAnimationFrame(this.#repaintFrame);
    this.#root = undefined;
  }

  /** The latest props; read when a file's callback fires, so files never re-render for them. */
  update(input: {
    readonly options: Readonly<Record<string, unknown>>;
    readonly selection: CodeViewLineSelection | null;
    readonly onSelectedLinesChange: ((selection: CodeViewLineSelection | null) => void) | undefined;
    readonly onRevealSearchMatch: ((item: CodeViewDiffItem<L>) => void) | undefined;
  }) {
    this.#options = input.options;
    this.#selection = input.selection;
    this.#onSelectedLinesChange = input.onSelectedLinesChange;
    this.#onRevealSearchMatch = input.onRevealSearchMatch;
  }

  setItems(items: ReadonlyArray<CodeViewDiffItem<L>>) {
    if (items === this.#items) return;
    // Hydration fills a partial diff's lines in place, so the search has new text to cover.
    const hydrated = items.some(
      (item) => this.#partialIds.has(item.id) && item.fileDiff.isPartial !== true,
    );
    this.#items = items;
    this.#partialIds = new Set(
      items.filter((item) => item.fileDiff.isPartial === true).map((item) => item.id),
    );
    this.search.refresh(hydrated);
    this.#resumeReveal();
  }

  registerFile(id: string, element: HTMLElement, instance: VirtualizedFileDiff<L>) {
    this.#files.set(id, { element, instance });
    this.#resumeReveal();
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
    callbacks.onPostRender = (...args) => {
      this.#scheduleRepaint();
      return this.#call("onPostRender", id, args);
    };
    return callbacks as Partial<FileDiffOptions<L, undefined>>;
  }

  #call(key: string, id: string, args: unknown[]) {
    const callback = this.#options[key] as HostCallback | undefined;
    const item = this.#items.find((candidate) => candidate.id === id);
    const file = this.#files.get(id);
    if (callback === undefined || item === undefined) return undefined;
    return callback(...args, { type: "diff", item, instance: file?.instance });
  }

  #scheduleRepaint() {
    if (this.#repaintFrame !== 0) return;
    this.#repaintFrame = requestAnimationFrame(() => {
      this.#repaintFrame = 0;
      this.search.repaint();
    });
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

  // Find

  getContainerElement() {
    return this.#root;
  }

  getStickyHeaderOffset() {
    return 0;
  }

  getSearchItems() {
    return this.#items;
  }

  getFirstVisibleSearchMatchIndex(entries: readonly CodeViewSearchMatch[]) {
    const root = this.#root;
    if (root === undefined) return 0;
    const index = entries.findIndex(
      (entry) =>
        (this.#lineBox(entry.id, entry.lineNumber, entry.side)?.top ?? -1) >= root.scrollTop,
    );
    return Math.max(index, 0);
  }

  cancelSearchReveal() {
    this.#pendingReveal = undefined;
  }

  /**
   * Bring a match on screen. A folded file is unfolded by the surface through
   * `onRevealSearchMatch` (folding is its state), and the reveal resumes once it arrives unfolded.
   */
  revealSearchMatch(match: CodeViewSearchMatch) {
    const root = this.#root;
    const item = this.#items.find((candidate) => candidate.id === match.id);
    if (root === undefined || item === undefined) return;
    const file = this.#files.get(match.id);
    if (item.collapsed === true || file === undefined) {
      this.#pendingReveal = match;
      if (item.collapsed === true) this.#onRevealSearchMatch?.(item);
      return;
    }
    this.#pendingReveal = undefined;
    if (match.side === "additions" && !file.instance.isLineRenderable(match.lineNumber)) {
      file.instance.revealLine(match.lineNumber);
    }
    const line = this.#lineBox(match.id, match.lineNumber, match.side);
    if (line === undefined) return;
    const visibleTop = root.scrollTop + SEARCH_PANEL_RESERVED_HEIGHT;
    const visibleBottom = root.scrollTop + root.clientHeight;
    if (line.top >= visibleTop && line.top + line.height <= visibleBottom) return;
    // Center in the space below the find panel.
    const below = root.clientHeight - SEARCH_PANEL_RESERVED_HEIGHT;
    root.scrollTo({
      top: Math.max(0, line.top + line.height / 2 - SEARCH_PANEL_RESERVED_HEIGHT - below / 2),
    });
  }

  #resumeReveal() {
    const pending = this.#pendingReveal;
    if (pending === undefined) return;
    const item = this.#items.find((candidate) => candidate.id === pending.id);
    if (item === undefined || item.collapsed === true || !this.#files.has(pending.id)) return;
    queueMicrotask(() => {
      if (this.#pendingReveal === pending) this.revealSearchMatch(pending);
    });
  }

  /** Pair each match with its mounted line element; lines outside the window are skipped. */
  getMountedSearchMatches(entriesByItem: ReadonlyMap<number, readonly CodeViewSearchMatch[]>) {
    const mounted: { entry: CodeViewSearchMatch; element: HTMLElement }[] = [];
    for (const [index, entries] of entriesByItem) {
      const item = this.#items[index];
      const shadowRoot = item ? this.#files.get(item.id)?.element.shadowRoot : null;
      if (shadowRoot == null) continue;
      const lines = new Map<string, HTMLElement>();
      for (const element of shadowRoot.querySelectorAll<HTMLElement>(
        "[data-line][data-line-index]",
      )) {
        const unifiedIndex = element.getAttribute("data-line-index")?.split(",")[0];
        const column = element.closest("[data-deletions]") != null ? "deletions" : "additions";
        lines.set(`${column}:${unifiedIndex}`, element);
      }
      for (const entry of entries) {
        // Split view draws unchanged context in both columns, so paint each copy.
        const additions = lines.get(`additions:${entry.unifiedLineIndex}`);
        const deletions = lines.get(`deletions:${entry.unifiedLineIndex}`);
        const elements =
          entry.side === "deletions"
            ? [deletions ?? additions]
            : entry.isContext
              ? [additions, deletions]
              : [additions];
        for (const element of elements) if (element != null) mounted.push({ entry, element });
      }
    }
    return mounted;
  }

  /** Scroll a wide code column so the current match is visible when lines don't wrap. */
  revealSearchMatchHorizontally(match: CodeViewSearchMatch, element: HTMLElement) {
    const file = this.#files.get(match.id);
    const code = element.closest<HTMLElement>("[data-code]");
    if (file === undefined || code === null || code.scrollWidth <= code.clientWidth) return;
    const codeRect = code.getBoundingClientRect();
    const matchRect = textRangeRect(element, match.start, match.end);
    if (matchRect === undefined) return;
    // The line-number gutter is sticky at the left edge and covers the code under it.
    const gutterRight = code.querySelector(":scope > [data-gutter]")?.getBoundingClientRect().right;
    const visibleLeft =
      gutterRight !== undefined && gutterRight > codeRect.left ? gutterRight : codeRect.left;
    const padding = 24;
    let next = code.scrollLeft;
    if (matchRect.left < visibleLeft + padding) next -= visibleLeft + padding - matchRect.left;
    else if (matchRect.right > codeRect.right - padding) {
      next += matchRect.right - (codeRect.right - padding);
    } else return;
    file.instance.setCodeScrollLeft(Math.max(0, next));
  }
}

function textRangeRect(lineElement: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Text | undefined;
  let startOffset = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const text = node as Text;
    const length = text.data.length;
    if (startNode === undefined && start < consumed + length) {
      startNode = text;
      startOffset = start - consumed;
    }
    if (startNode !== undefined && end <= consumed + length) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(text, end - consumed);
      return range.getBoundingClientRect();
    }
    consumed += length;
  }
  return undefined;
}
