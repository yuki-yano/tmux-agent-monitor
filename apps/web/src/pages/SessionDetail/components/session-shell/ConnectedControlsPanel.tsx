import { memo } from "react";

import { ControlsPanel } from "../ControlsPanel";
import { useConnectedControlsPanelProps } from "./useConnectedControlsPanelProps";

type ConnectedControlsPanelProps = {
  showComposerSection?: boolean;
  showKeysSection?: boolean;
};

export const ConnectedControlsPanel = memo(
  ({ showComposerSection, showKeysSection }: ConnectedControlsPanelProps) => {
    const { state, actions } = useConnectedControlsPanelProps();

    return (
      <ControlsPanel
        state={state}
        actions={actions}
        showComposerSection={showComposerSection}
        showKeysSection={showKeysSection}
      />
    );
  },
);

ConnectedControlsPanel.displayName = "ConnectedControlsPanel";
