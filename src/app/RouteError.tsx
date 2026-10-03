import { Compass, TriangleAlert } from "lucide-react";
import { Link, useRouteError } from "react-router";
import { errorMessage } from "@/api/errors";
import { EmptyState } from "@/components/common/page";
import { Button } from "@/components/ui/button";

export function RouteError() {
  const error = useRouteError();
  return (
    <div className="flex h-screen items-center justify-center p-6">
      <EmptyState
        icon={<TriangleAlert />}
        title="Something went wrong on this screen"
        description={errorMessage(error)}
        action={
          <Button onClick={() => window.location.reload()} variant="outline">
            Reload
          </Button>
        }
      />
    </div>
  );
}

export function NotFound() {
  return (
    <EmptyState
      className="py-24"
      icon={<Compass />}
      title="Page not found"
      description="This screen does not exist."
      action={
        <Button asChild variant="outline">
          <Link to="/">Go to dashboard</Link>
        </Button>
      }
    />
  );
}
