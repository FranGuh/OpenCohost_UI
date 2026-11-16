import { useState } from "react";
import { useSetupStateQuery, useUpdateSetupState } from "../../api/setup.js";
import { SetupFlow } from "./SetupFlow.js";
import { takeSetupSection } from "./setupCheckpoint.js";

/**
 * `/setup` command screen: the same SetupFlow, inline. Finishing records
 * "completed" (best effort) and closes; closing hands back to the command
 * panel without touching the setup status. A setup that is already completed
 * re-opens on its summary, prefilled from the current configuration, so the
 * user can change just one part; `/setup <section>` opens that part directly
 * (S10). An unfinished setup offers to continue from its saved checkpoint.
 */
export function SetupCommandScreen({ onClose }: { onClose: () => void }) {
  const updateSetup = useUpdateSetupState();
  const query = useSetupStateQuery();
  // Taken on the first render: the launcher stashed it right before mounting this screen.
  const [section] = useState(takeSetupSection);
  // Wait for the status so the flow mounts once with the right start screen.
  if (query.isPending) return <></>;
  const completed = query.data?.status === "completed";
  return (
    <SetupFlow
      variant="panel"
      resume={completed}
      checkpoint={completed ? null : query.data?.checkpoint ?? null}
      checkpointReset={Boolean(query.data?.checkpoint_reset)}
      section={section}
      onClose={onClose}
      onComplete={() => {
        updateSetup.mutate("completed");
        onClose();
      }}
    />
  );
}
