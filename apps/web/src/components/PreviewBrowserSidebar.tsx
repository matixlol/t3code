import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import PreviewBrowserPanel from "./PreviewBrowserPanel";

const PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY = "chat_preview_sidebar_width";
const PREVIEW_SIDEBAR_MIN_WIDTH = 24 * 16;
const PREVIEW_SIDEBAR_DEFAULT_WIDTH = 36 * 16;
const PREVIEW_SIDEBAR_MAX_WIDTH = 48 * 16;
const PREVIEW_SIDEBAR_MIN_MAIN_WIDTH = 420;

function maxPreviewSidebarWidth(): number {
  if (typeof window === "undefined") {
    return PREVIEW_SIDEBAR_DEFAULT_WIDTH;
  }

  const viewportBasedMax = Math.floor(window.innerWidth * 0.55);
  const remainingWidthMax = window.innerWidth - PREVIEW_SIDEBAR_MIN_MAIN_WIDTH;
  return Math.max(
    PREVIEW_SIDEBAR_MIN_WIDTH,
    Math.min(PREVIEW_SIDEBAR_MAX_WIDTH, viewportBasedMax, remainingWidthMax),
  );
}

function clampPreviewSidebarWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? width : PREVIEW_SIDEBAR_DEFAULT_WIDTH;
  const maxWidth = maxPreviewSidebarWidth();
  return Math.min(Math.max(Math.round(safeWidth), PREVIEW_SIDEBAR_MIN_WIDTH), maxWidth);
}

function readStoredPreviewSidebarWidth(): number {
  if (typeof window === "undefined") {
    return PREVIEW_SIDEBAR_DEFAULT_WIDTH;
  }

  const storedWidth = Number(window.localStorage.getItem(PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY));
  return clampPreviewSidebarWidth(storedWidth);
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
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredPreviewSidebarWidth());
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const persistWidth = useCallback((width: number) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      PREVIEW_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampPreviewSidebarWidth(width)),
    );
  }, []);

  useEffect(() => {
    const onWindowResize = () => {
      const clampedWidth = clampPreviewSidebarWidth(sidebarWidthRef.current);
      if (clampedWidth !== sidebarWidthRef.current) {
        setSidebarWidth(clampedWidth);
      }
      persistWidth(clampedWidth);
    };

    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [persistWidth]);

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
      persistWidth(sidebarWidthRef.current);
    },
    [persistWidth],
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
