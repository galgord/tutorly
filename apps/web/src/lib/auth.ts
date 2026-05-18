import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MeResponse } from '@tutor-app/shared';
import { ApiError, api } from './api';

export function useMe(): UseQueryResult<MeResponse | null, ApiError> {
  return useQuery<MeResponse | null, ApiError>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: (failureCount, err) => err.status >= 500 && failureCount < 2,
    staleTime: 30_000,
  });
}
