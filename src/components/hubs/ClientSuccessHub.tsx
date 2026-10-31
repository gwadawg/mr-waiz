"use client";

import { Suspense } from "react";
import ClientHealthDashboard from "@/components/ClientHealthDashboard";
import CriteriaRoom from "@/components/CriteriaRoom";
import CsTouchpointsQueue from "@/components/CsTouchpointsQueue";
import ViewHub from "@/components/nav/ViewHub";
import {
  CLIENT_SUCCESS_TABS,
  type ClientSuccessTab,
} from "@/lib/nav";

type Props = {
  tab: ClientSuccessTab;
  onTabChange: (tab: ClientSuccessTab) => void;
  onOpenClient?: (clientId: string) => void;
};

export default function ClientSuccessHub({
  tab,
  onTabChange,
  onOpenClient,
}: Props) {
  return (
    <ViewHub
      tabs={CLIENT_SUCCESS_TABS}
      activeTab={tab}
      onTabChange={key => onTabChange(key as ClientSuccessTab)}
    >
      {tab === "health" && <ClientHealthDashboard />}
      {tab === "followups" && <CsTouchpointsQueue onOpenClient={onOpenClient} />}
      {tab === "criteria" && (
        <Suspense fallback={null}>
          <CriteriaRoom />
        </Suspense>
      )}
    </ViewHub>
  );
}
