import { useCallback } from "react";
import { toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function useCopyBranchNameToClipboard(): {
  copyBranchNameToClipboard: (branch: string | null) => boolean;
} {
  const { copyToClipboard } = useCopyToClipboard<{ branch: string }>({
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch name copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy branch name",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const copyBranchNameToClipboard = useCallback(
    (branch: string | null): boolean => {
      if (!branch) {
        return false;
      }
      copyToClipboard(branch, { branch });
      return true;
    },
    [copyToClipboard],
  );

  return { copyBranchNameToClipboard };
}
