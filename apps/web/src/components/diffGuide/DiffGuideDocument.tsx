import {
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  DIFFS_TAG_NAME,
  type FileDiffOptions,
  type SelectedLineRange,
  VirtualizedFileDiff,
  Virtualizer,
  areOptionsEqual,
  getLineAnnotationName,
} from "@pierre/diffs";
import {
  type CodeViewAnnotationArgs,
  VirtualizerContext,
  WorkerPoolContext,
  renderDiffChildren,
} from "@pierre/diffs/react";
import {
  createElement,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useState,
} from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import {
  DIFF_VIEW_ITEM_METRICS,
  DIFF_VIEW_UNSAFE_CSS,
  type StyledDiffCodeViewOptions,
} from "../diffs/StyledDiffCodeView";
import type { DiffGuideGroup } from "./diffGuideOrder";
import { DiffGuideViewer, type DiffViewerHandle } from "./DiffGuideViewer";

/** CodeView options that describe the list rather than a file. */
const LIST_ONLY_OPTION_KEYS = new Set([
  "stickyHeaders",
  "smoothScrollSettings",
  "pointerEventsOnScroll",
  "onRevealSearchMatch",
  "onItemEditChange",
  "onItemEditComplete",
  "getEditStateKey",
  "createEditor",
]);

const NO_ANNOTATIONS: never[] = [];

interface FileRenderers<L> {
  readonly renderHeaderPrefix?: ((item: CodeViewItem<L>) => ReactNode) | undefined;
  readonly renderHeaderFilenameSuffix?: ((item: CodeViewItem<L>) => ReactNode) | undefined;
  readonly renderHeaderMetadata?: ((item: CodeViewItem<L>) => ReactNode) | undefined;
  readonly renderAnnotation?: ((...args: CodeViewAnnotationArgs<L>) => ReactNode) | undefined;
}

export interface DiffGuideDocumentProps<L> extends FileRenderers<L> {
  readonly groups: ReadonlyArray<DiffGuideGroup<CodeViewDiffItem<L>>>;
  /** A section's title and explanation, beside its files on a wide panel and above them else. */
  readonly renderSection: (group: DiffGuideGroup<CodeViewDiffItem<L>>) => ReactNode;
  readonly options?: StyledDiffCodeViewOptions<L> | undefined;
  readonly unsafeCSSExtra?: string | undefined;
  readonly selectedLines?: CodeViewLineSelection | null | undefined;
  readonly onSelectedLinesChange?: ((selection: CodeViewLineSelection | null) => void) | undefined;
  readonly renderCodeViewHeader?: (() => ReactNode) | undefined;
  readonly renderCodeViewFooter?: (() => ReactNode) | undefined;
  readonly viewerRef?: ((handle: DiffViewerHandle | null) => void) | undefined;
  readonly containerRef?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * A guided diff laid out like Linear's: each section is a row with its explanation beside its
 * files, held at the top while they scroll past, and above them on a narrow panel. It takes
 * StyledDiffCodeView's props, so a surface's comments, folding and find work the same in it; each
 * file is the library's own virtualized diff, so only the lines on screen are drawn.
 */
export function DiffGuideDocument<L>({
  groups,
  renderSection,
  options,
  unsafeCSSExtra,
  selectedLines = null,
  onSelectedLinesChange,
  renderCodeViewHeader,
  renderCodeViewFooter,
  viewerRef,
  containerRef,
  className,
  ...renderers
}: DiffGuideDocumentProps<L>) {
  const [viewer] = useState(() => new DiffGuideViewer<L>());
  const [virtualizer] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : new Virtualizer({ overscrollSize: 600, intersectionObserverMargin: 1200 }),
  );
  const items = groups.flatMap((group) => group.items);
  const fileOptions = {
    ...Object.fromEntries(
      Object.entries(options ?? {}).filter(([key]) => !LIST_ONLY_OPTION_KEYS.has(key)),
    ),
    unsafeCSS: unsafeCSSExtra ? `${DIFF_VIEW_UNSAFE_CSS}\n${unsafeCSSExtra}` : DIFF_VIEW_UNSAFE_CSS,
    // Selection belongs to the document, which keeps one across files as CodeView does.
    controlledSelection: true,
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the imperative viewer the latest items and callbacks before files render
  useLayoutEffect(() => {
    viewer.update({
      options: options ?? {},
      selection: selectedLines,
      onSelectedLinesChange,
    });
    viewer.setItems(items);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the imperative viewer with the parent's handle callback while mounted
  useEffect(() => {
    viewerRef?.(viewer);
    return () => viewerRef?.(null);
  }, [viewer, viewerRef]);

  const assignContainerRef = useStableCallback((node: HTMLDivElement | null) =>
    containerRef?.(node),
  );
  const rootRef = (node: HTMLDivElement | null) => {
    if (node !== null) {
      virtualizer?.setup(node);
      viewer.attach(node);
    } else {
      viewer.detach();
      virtualizer?.cleanUp();
    }
    assignContainerRef(node);
  };

  return (
    <DiffWorkerPoolProvider>
      <VirtualizerContext.Provider value={virtualizer}>
        <div
          ref={rootRef}
          // Focusable so find's shortcut reaches it, as CodeView's own element is.
          tabIndex={0}
          className={cn(
            "@container diff-render-surface [--code-background:var(--background)] outline-none",
            className,
          )}
        >
          {renderCodeViewHeader?.()}
          {groups.map((group) => (
            <section
              key={group.key}
              className="grid border-t border-border/60 @min-[1100px]:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
            >
              <div className="px-4 pt-3 pb-4 @min-[1100px]:sticky @min-[1100px]:top-0 @min-[1100px]:self-start">
                {renderSection(group)}
              </div>
              <div className="min-w-0 border-border/60 @min-[1100px]:border-l">
                {group.items.map((item) => (
                  <DiffGuideFile<L>
                    key={item.id}
                    item={item}
                    viewer={viewer}
                    options={fileOptions}
                    selectedRange={selectedLines?.id === item.id ? selectedLines.range : null}
                    {...renderers}
                  />
                ))}
              </div>
            </section>
          ))}
          {renderCodeViewFooter?.()}
        </div>
      </VirtualizerContext.Provider>
    </DiffWorkerPoolProvider>
  );
}

interface DiffGuideFileProps<L> extends FileRenderers<L> {
  readonly item: CodeViewDiffItem<L>;
  readonly viewer: DiffGuideViewer<L>;
  readonly options: FileDiffOptions<L, undefined>;
  readonly selectedRange: SelectedLineRange | null;
}

/**
 * One file of a guide document: the library's virtualized diff, created here rather than through
 * its React component so the document can reach it to place lines for find and file reveals.
 */
const DiffGuideFile = memo(function DiffGuideFile<L>({
  item,
  viewer,
  options,
  selectedRange,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
}: DiffGuideFileProps<L>) {
  const virtualizer = useContext(VirtualizerContext);
  const workerPool = useContext(WorkerPoolContext);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [, requestRender] = useReducer((count: number) => count + 1, 0);
  const [instance, setInstance] = useState<VirtualizedFileDiff<L> | null>(null);
  const fileOptions = {
    ...options,
    ...viewer.callbacksFor(item.id, options),
    collapsed: item.collapsed === true,
  };
  const annotations = item.annotations ?? NO_ANNOTATIONS;

  // The instance is created once per element; the effect below hands it every later change.
  const createInstance = useEffectEvent((element: HTMLElement, owner: Virtualizer) => {
    const created = new VirtualizedFileDiff<L>(
      fileOptions,
      owner,
      DIFF_VIEW_ITEM_METRICS,
      workerPool,
      requestRender,
    );
    created.hydrate({
      fileDiff: item.fileDiff,
      fileContainer: element,
      lineAnnotations: annotations,
    });
    viewer.registerFile(item.id, element, created);
    return { created, id: item.id };
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the library's imperative file renderer for this element while mounted
  useLayoutEffect(() => {
    if (container === null || virtualizer === undefined) return;
    const { created, id } = createInstance(container, virtualizer);
    // oxlint-disable-next-line react/set-state-in-effect -- The renderer exists only once its element mounts.
    setInstance(created);
    return () => {
      viewer.unregisterFile(id, created);
      created.cleanUp();
      setInstance(null);
    };
  }, [container, viewer, virtualizer]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes each render's options and diff into the imperative file renderer
  useLayoutEffect(() => {
    if (instance === null) return;
    const forceRender = !areOptionsEqual(instance.options, fileOptions);
    instance.setOptions(fileOptions);
    instance.render({ forceRender, fileDiff: item.fileDiff, lineAnnotations: annotations });
    instance.setSelectedLines(selectedRange, { notify: false });
  });

  return createElement(
    DIFFS_TAG_NAME,
    { ref: setContainer },
    renderDiffChildren<L, undefined, VirtualizedFileDiff<L>>({
      fileDiff: item.fileDiff,
      renderCustomHeader: undefined,
      renderHeaderPrefix: renderHeaderPrefix && (() => renderHeaderPrefix(item)),
      renderHeaderFilenameSuffix:
        renderHeaderFilenameSuffix && (() => renderHeaderFilenameSuffix(item)),
      renderHeaderMetadata: renderHeaderMetadata && (() => renderHeaderMetadata(item)),
      renderAnnotation:
        renderAnnotation && ((annotation) => renderAnnotation(annotation, item.fileDiff, item)),
      renderGutterUtility: undefined,
      lineAnnotations: annotations,
      getHoveredLine: () => instance?.getHoveredLine(),
      getAnnotationSlotName: (annotation) =>
        instance?.getAnnotationSlotName(annotation) ?? getLineAnnotationName(annotation),
    }),
  );
}) as <L>(props: DiffGuideFileProps<L>) => ReactNode;
