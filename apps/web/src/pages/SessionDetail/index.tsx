import { useParams } from "@tanstack/react-router";

import { SessionDetailView } from "./SessionDetailView";
import { useSessionDetailVM } from "./useSessionDetailVM";

export const SessionDetailPage = () => {
  const { paneId } = useParams({ from: "/sessions/$paneId" });
  const viewModel = useSessionDetailVM(paneId);

  return <SessionDetailView {...viewModel} />;
};
