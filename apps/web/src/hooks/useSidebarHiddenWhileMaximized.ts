import { useEffect, useEffectEvent, useRef } from "react";

import { useSidebar } from "~/components/ui/sidebar";

/**
 * Hides the app sidebar while the right panel is maximized, and brings it back when the panel is
 * restored or the view goes away, but only if this hid it: a sidebar the reader had already
 * closed, or opened again by hand while maximized, stays as they left it.
 */
export function useSidebarHiddenWhileMaximized(maximized: boolean) {
  const { isMobile, open, setOpen } = useSidebar();
  const hidSidebar = useRef(false);
  const sync = useEffectEvent((nextMaximized: boolean) => {
    if (isMobile) return;
    if (nextMaximized) {
      if (open) {
        hidSidebar.current = true;
        setOpen(false);
      }
      return;
    }
    if (hidSidebar.current) {
      hidSidebar.current = false;
      setOpen(true);
    }
  });
  useEffect(() => {
    sync(maximized);
  }, [maximized]);
  const restore = useEffectEvent(() => {
    if (!hidSidebar.current) return;
    hidSidebar.current = false;
    setOpen(true);
  });
  useEffect(() => () => restore(), []);
}
