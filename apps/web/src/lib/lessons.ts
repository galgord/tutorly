import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  CalendarMergeResponse,
  CalendarRangeQuery,
  LessonListResponse,
  LessonResponse,
  ListLessonsQuery,
} from '@tutor-app/shared';
import { ApiError, api } from './api';

export function useLessonsForStudent(
  query: ListLessonsQuery | null,
): UseQueryResult<LessonListResponse, ApiError> {
  return useQuery<LessonListResponse, ApiError>({
    queryKey: ['lessons', query],
    queryFn: () => api.listLessons(query!),
    enabled: !!query,
    staleTime: 10_000,
  });
}

export function useLesson(id: string | undefined): UseQueryResult<LessonResponse | null, ApiError> {
  return useQuery<LessonResponse | null, ApiError>({
    queryKey: ['lesson', id],
    queryFn: async () => {
      try {
        return await api.getLesson(id!);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function useCalendar(
  range: CalendarRangeQuery,
): UseQueryResult<CalendarMergeResponse, ApiError> {
  return useQuery<CalendarMergeResponse, ApiError>({
    queryKey: ['calendar', range],
    queryFn: () => api.calendarMerge(range),
    // Re-fetch on focus so newly-added Google events appear.
    staleTime: 30_000,
  });
}
