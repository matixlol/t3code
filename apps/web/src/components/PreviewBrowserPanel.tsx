import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { normalizePreviewUrl } from "~/preview-browser";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface PreviewBrowserPanelProps {
  url: string;
  onNavigate: (url: string) => void;
  className?: string;
}

const IFRAME_SANDBOX = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-pointer-lock",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
].join(" ");

export default function PreviewBrowserPanel({
  url,
  onNavigate,
  className,
}: PreviewBrowserPanelProps) {
  const [draftUrl, setDraftUrl] = useState(url);
  const [frameNonce, setFrameNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftUrl(url);
    setIsLoading(true);
    setMessage(null);
  }, [url]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setIsLoading(false);
    }, 8_000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [frameNonce, isLoading, url]);

  const reloadPreview = () => {
    setIsLoading(true);
    setMessage(null);
    setFrameNonce((value) => value + 1);
  };

  const submitNavigation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUrl = normalizePreviewUrl(draftUrl);
    if (!normalizedUrl) {
      setMessage("Enter a valid http:// or https:// URL.");
      return;
    }
    if (normalizedUrl === url) {
      reloadPreview();
      return;
    }
    setMessage(null);
    setIsLoading(true);
    onNavigate(normalizedUrl);
  };

  const openInBrowser = async () => {
    const api = readLocalApi();
    if (!api) {
      setMessage("Local API unavailable.");
      return;
    }

    try {
      await api.shell.openExternal(url);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open preview in browser.");
    }
  };

  return (
    <section
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col border-l border-border/70 bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/70 px-2 py-1.5">
        <form onSubmit={submitNavigation} className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://localhost:3000"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Preview URL"
            aria-invalid={message ? true : undefined}
            className="min-w-0"
          />
        </form>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Reload preview"
          title="Reload preview"
          onClick={reloadPreview}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Open preview in browser"
          title="Open preview in browser"
          onClick={() => {
            void openInBrowser();
          }}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Button>
      </div>

      {message ? (
        <div className="border-b border-border/70 px-2 py-1 text-[11px] text-destructive">
          {message}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-background">
        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/88 text-xs text-muted-foreground">
            Loading preview…
          </div>
        ) : null}
        <iframe
          key={`${url}::${frameNonce}`}
          title="Preview browser"
          src={url}
          className="h-full w-full border-0 bg-background"
          allow="clipboard-read; clipboard-write; fullscreen"
          sandbox={IFRAME_SANDBOX}
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
      </div>
    </section>
  );
}
