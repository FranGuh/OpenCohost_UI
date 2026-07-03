import { QueryClient } from "@tanstack/react-query";

// ponytail: covered transitively by hook tests (status.test.ts, profiles.test.ts).
// Add a dedicated test only if retry/backoff behavior regresses.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000)
    },
    mutations: {
      retry: false
    }
  }
});
