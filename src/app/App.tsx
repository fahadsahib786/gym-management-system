import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { useEffect } from "react";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "sonner";
import { api } from "@/api/client";
import { ErrorState } from "@/components/common/page";
import { TooltipProvider } from "@/components/ui/menus";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { SetupWizard } from "@/features/setup/SetupWizard";
import { useSession } from "@/stores/session";
import { useUi } from "@/stores/ui";
import { queryClient } from "./query";
import { router } from "./router";

export function App() {
  const theme = useUi((s) => s.theme);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <Boot />
        <Toaster
          position="top-right"
          richColors
          closeButton
          theme={theme === "system" ? "system" : theme}
          toastOptions={{ duration: 3500 }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
        <Dumbbell className="size-7" />
      </div>
      <p className="text-muted-foreground text-sm">Starting Danish Fitness…</p>
    </div>
  );
}

function Boot() {
  const actor = useSession((s) => s.actor);
  const setActor = useSession((s) => s.setActor);
  const setStatus = useSession((s) => s.setStatus);
  const status = useQuery({
    queryKey: ["app-status"],
    queryFn: api.app.status,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Show the (hidden) native window only after the first paint: no white flash.
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => void api.app.ready().catch(() => {})));
  }, []);

  useEffect(() => {
    if (status.data) setStatus(status.data);
  }, [status.data, setStatus]);

  if (status.isPending) return <Splash />;
  if (status.error || !status.data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      </div>
    );
  }
  if (!status.data.setupComplete) {
    return (
      <SetupWizard
        onDone={(owner) => {
          setActor(owner);
          void status.refetch();
        }}
      />
    );
  }
  if (!actor) {
    return <LoginScreen status={status.data} onLogin={setActor} />;
  }
  return <RouterProvider router={router} />;
}
