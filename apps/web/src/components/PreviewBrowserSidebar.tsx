import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import PreviewBrowserPanel from "./PreviewBrowserPanel";

const PREVIEW_SIDEBAR_WIDTH_RATIO_STORAGE_KEY = "chat_preview_sidebar_width_ratio";
const PREVIEW_SIDEBAR_MIN_WIDTH = 24 * 16;
const PREVIEW_SIDEBAR_DEFAULT_WIDTH = 36 * 16;
const PREVIEW_SIDEBAR_MIN_MAIN_WIDTH = 420;

function maxPreviewSidebarWidth(): number {
  if (typeof window === "undefined") {
    return PREVIEW_SIDEBAR_DEFAULT_WIDTH;
  }

  const remainingWidthMax = window.innerWidth - PREVIEW_SIDEBAR_MIN_MAIN_WIDTH;
  return Math.max(PREVIEW_SIDEBAR_MIN_WIDTH, remainingWidthMax);
}

function clampPreviewSidebarWidth(width: number, maxWidth = maxPreviewSidebarWidth()): number {
  const safeWidth = Number.isFinite(width) ? width : PREVIEW_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(Math.round(safeWidth), PREVIEW_SIDEBAR_MIN_WIDTH), maxWidth);
}

function clampPreviewSidebarWidthRatio(widthRatio: number): number {
  const safeRatio = Number.isFinite(widthRatio) ? widthRatio : 1;
  return Math.min(Math.max(safeRatio, 0), 1);
}

function widthRatioFromWidth(width: number, maxWidth = maxPreviewSidebarWidth()): number {
  return clampPreviewSidebarWidthRatio(clampPreviewSidebarWidth(width, maxWidth) / maxWidth);
}

function widthFromRatio(widthRatio: number, maxWidth = maxPreviewSidebarWidth()): number {
  return clampPreviewSidebarWidth(maxWidth * clampPreviewSidebarWidthRatio(widthRatio), maxWidth);
}

function defaultPreviewSidebarWidthRatio(): number {
  return widthRatioFromWidth(PREVIEW_SIDEBAR_DEFAULT_WIDTH);
}

function readStoredPreviewSidebarWidth(): { width: number; widthRatio: number } {
  if (typeof window === "undefined") {
    return {
      width: PREVIEW_SIDEBAR_DEFAULT_WIDTH,
      widthRatio: defaultPreviewSidebarWidthRatio(),
    };
  }

  const storedWidthRatio = Number(
    window.localStorage.getItem(PREVIEW_SIDEBAR_WIDTH_RATIO_STORAGE_KEY),
  );
  const widthRatio = Number.isFinite(storedWidthRatio)
    ? clampPreviewSidebarWidthRatio(storedWidthRatio)
    : defaultPreviewSidebarWidthRatio();
  return { width: widthFromRatio(widthRatio), widthRatio };
}

interface PreviewBrowserSidebarProps {
  open: boolean;
  url: string;
  onNavigate: (url: string) => void;
}

export default function PreviewBrowserSidebar({
  open,
  url,
  onNavigate,
}: PreviewBrowserSidebarProps) {
  const [{ width: initialSidebarWidth, widthRatio: initialSidebarWidthRatio }] = useState(
    readStoredPreviewSidebarWidth,
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarWidthRatioRef = useRef(initialSidebarWidthRatio);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const persistWidthRatio = useCallback((widthRatio: number) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      PREVIEW_SIDEBAR_WIDTH_RATIO_STORAGE_KEY,
      String(clampPreviewSidebarWidthRatio(widthRatio)),
    );
  }, []);

  useEffect(() => {
    const onWindowResize = () => {
      const nextWidth = widthFromRatio(sidebarWidthRatioRef.current);
      if (nextWidth !== sidebarWidthRef.current) {
        sidebarWidthRef.current = nextWidth;
        setSidebarWidth(nextWidth);
      }
      persistWidthRatio(sidebarWidthRatioRef.current);
    };

    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [persistWidthRatio]);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!open || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      didResizeDuringDragRef.current = false;
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebarWidthRef.current,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [open],
  );

  const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextWidth = clampPreviewSidebarWidth(
      resizeState.startWidth + (resizeState.startX - event.clientX),
    );
    if (nextWidth === sidebarWidthRef.current) {
      return;
    }
    didResizeDuringDragRef.current = true;
    sidebarWidthRef.current = nextWidth;
    sidebarWidthRatioRef.current = widthRatioFromWidth(nextWidth);
    setSidebarWidth(nextWidth);
  }, []);

  const endResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      if (!didResizeDuringDragRef.current) {
        return;
      }
      persistWidthRatio(sidebarWidthRatioRef.current);
    },
    [persistWidthRatio],
  );

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, []);

  if (!open) {
    return null;
  }

  return (
    <aside
      className="relative flex min-h-0 shrink-0 overflow-hidden"
      style={{ width: `${sidebarWidth}px`, minWidth: `${PREVIEW_SIDEBAR_MIN_WIDTH}px` }}
    >
      <button
        type="button"
        aria-label="Resize preview panel"
        title="Drag to resize preview panel"
        className="absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize md:flex"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70"
        />
      </button>
      <PreviewBrowserPanel
        url={url}
        onNavigate={onNavigate}
        className="min-h-0 h-full border-l-0 bg-card/50"
      />
    </aside>
  );
}
