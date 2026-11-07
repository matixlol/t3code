import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

const HIDE_SUPPORTING_FILES_STORAGE_KEY = "mode:diff-hide-supporting-files";

/** Whether diffs leave out tests and generated files; on by default so review starts at the code. */
export function useHideSupportingFiles() {
  return useLocalStorage(HIDE_SUPPORTING_FILES_STORAGE_KEY, true, Schema.Boolean);
}
