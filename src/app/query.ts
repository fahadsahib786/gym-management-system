import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toAppError } from "@/api/errors";
import { setWriteListener } from "@/api/transport";
import { useSession } from "@/stores/session";

function onAuthError(error: unknown) {
  if (toAppError(error).kind === "unauthenticated") {
    useSession.getState().setActor(null);
  }
}

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        const kind = toAppError(error).kind;
        return count < 1 && !["unauthenticated", "forbidden", "validation", "notFound"].includes(kind);
      },
    },
  },
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
});

// Local queries are cheap: after any change, refresh whatever is on screen so every view agrees.
setWriteListener(() => {
  void queryClient.invalidateQueries();
});
