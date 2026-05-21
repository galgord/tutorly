import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GameListResponse, GameResponse, StudentGamesResponse } from '@tutor-app/shared';
import { ApiError, api } from './api';

/**
 * Hook for the lesson's game list. Polls every 1.5s while mounted so the
 * status badge flips from GENERATING → DRAFT/FAILED without an explicit
 * setInterval. We poll unconditionally rather than driving the interval
 * from a callback because react-query v5's `refetchInterval(query)`
 * sometimes reads stale state and never re-fires; a fixed cadence avoids
 * that footgun and stops automatically when the panel unmounts.
 */
export function useLessonGames(
  lessonId: string | undefined,
): UseQueryResult<GameListResponse, ApiError> {
  return useQuery<GameListResponse, ApiError>({
    queryKey: ['lesson-games', lessonId],
    queryFn: () => api.listGames(lessonId!),
    enabled: !!lessonId,
    refetchInterval: 1_500,
    refetchIntervalInBackground: false,
    staleTime: 1_000,
  });
}

/**
 * Hook for a single game; polls every 800ms while mounted so the review
 * modal surfaces the pool as soon as the worker finishes. Polling stops
 * when the modal unmounts (id becomes undefined).
 */
export function useGame(id: string | undefined): UseQueryResult<GameResponse, ApiError> {
  return useQuery<GameResponse, ApiError>({
    queryKey: ['game', id],
    queryFn: () => api.getGame(id!),
    enabled: !!id,
    refetchInterval: 800,
    refetchIntervalInBackground: false,
    staleTime: 500,
  });
}

/** Every game across a student's lessons — for the student page's grid. */
export function useStudentGames(
  studentId: string | undefined,
): UseQueryResult<StudentGamesResponse, ApiError> {
  return useQuery<StudentGamesResponse, ApiError>({
    queryKey: ['student-games', studentId],
    queryFn: () => api.listStudentGames(studentId!),
    enabled: !!studentId,
    staleTime: 10_000,
  });
}
