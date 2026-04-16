const ABSOLUTE_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const HOSTNAME_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?(?:[/?#]|$)/i;

function withImplicitProtocol(value: string): string {
  if (ABSOLUTE_SCHEME_PATTERN.test(value)) {
    return value;
  }

  if (LOCAL_HOST_PATTERN.test(value)) {
    return `http://${value}`;
  }

  if (HOSTNAME_PATTERN.test(value)) {
    return `https://${value}`;
  }

  return value;
}

export function normalizePreviewUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const candidate = withImplicitProtocol(trimmed);

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return parsed.toString();
}
