import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

/** Tutor-facing aggregated progress for a student. */
export function useStudentProgress(studentId: string | null) {
  return useQuery({
    queryKey: ['student-progress', studentId],
    enabled: !!studentId,
    queryFn: () => api.studentProgress(studentId!),
    // Reasonably fresh; the dashboard isn't a real-time view.
    staleTime: 30_000,
    retry: (failureCount, err) =>
      err instanceof ApiError && err.status >= 500 && failureCount < 2,
  });
}

/** Paginated recent attempts (with per-question detail inline). */
export function useStudentAttempts(
  studentId: string | null,
  page: number,
  limit: number,
) {
  return useQuery({
    queryKey: ['student-attempts', studentId, page, limit],
    enabled: !!studentId,
    queryFn: () => api.listStudentAttempts(studentId!, { page, limit }),
    staleTime: 30_000,
    retry: (failureCount, err) =>
      err instanceof ApiError && err.status >= 500 && failureCount < 2,
  });
}
