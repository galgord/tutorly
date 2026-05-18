import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ListStudentsQuery,
  PublicStudentResponse,
  StudentListResponse,
  StudentResponse,
} from '@tutor-app/shared';
import { ApiError, api } from './api';

export function useStudents(
  query: ListStudentsQuery,
): UseQueryResult<StudentListResponse, ApiError> {
  return useQuery<StudentListResponse, ApiError>({
    queryKey: ['students', query],
    queryFn: () => api.listStudents(query),
    staleTime: 10_000,
    // Page-token-style search shouldn't flicker between empty/list while typing.
    placeholderData: (prev) => prev,
  });
}

export function useStudent(id: string | undefined): UseQueryResult<StudentResponse, ApiError> {
  return useQuery<StudentResponse, ApiError>({
    queryKey: ['student', id],
    queryFn: () => api.getStudent(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useTrashStudents(
  query: ListStudentsQuery,
): UseQueryResult<StudentListResponse, ApiError> {
  return useQuery<StudentListResponse, ApiError>({
    queryKey: ['trash-students', query],
    queryFn: () => api.listTrashStudents(query),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function usePublicStudent(shareToken: string): UseQueryResult<PublicStudentResponse | null, ApiError> {
  return useQuery<PublicStudentResponse | null, ApiError>({
    queryKey: ['public-student', shareToken],
    queryFn: async () => {
      try {
        return await api.publicStudent(shareToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    retry: (failureCount, err) => err.status >= 500 && failureCount < 2,
    staleTime: 30_000,
  });
}

/** `${origin}/s/${shareToken}` — the URL the tutor distributes to the student. */
export function buildShareUrl(shareToken: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/s/${encodeURIComponent(shareToken)}`;
}
