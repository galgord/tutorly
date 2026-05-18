import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { TranscriptionStatusResponse } from '@tutor-app/shared';
import { ApiError, api } from './api';

/**
 * Hook to upload a recorded audio blob to the server, kicking off the
 * Whisper transcription job. Mirrors the games-create mutation shape so
 * the surrounding component can react to onSuccess / onError consistently.
 */
export function useUploadLessonAudio(lessonId: string) {
  const qc = useQueryClient();
  return useMutation<TranscriptionStatusResponse, ApiError, { blob: Blob; durationSeconds: number; fileName?: string }>({
    mutationFn: (input) => api.uploadLessonAudio(lessonId, input),
    onSuccess: async () => {
      // Invalidate so the LessonDetail re-fetches the lesson + status
      // immediately; the polling hook below also covers slower paths.
      await qc.invalidateQueries({ queryKey: ['lesson', lessonId] });
      await qc.invalidateQueries({ queryKey: ['lesson-audio', lessonId] });
    },
  });
}

/**
 * Poll the transcription status. We poll every 1.5s unconditionally
 * whenever the component is mounted — the caller (VoiceRecorder)
 * unmounts when the tutor leaves the voice tab, so polling stops then.
 *
 * Uses fixed-cadence polling (NOT refetchInterval-callback) because
 * react-query v5's callback form sometimes reads stale state and never
 * re-fires — same footgun documented in lib/games.ts.
 */
export function useLessonAudioStatus(
  lessonId: string | undefined,
  _currentStatus: TranscriptionStatusResponse['transcriptionStatus'] | undefined,
): UseQueryResult<TranscriptionStatusResponse, ApiError> {
  const qc = useQueryClient();
  return useQuery<TranscriptionStatusResponse, ApiError>({
    queryKey: ['lesson-audio', lessonId],
    queryFn: async () => {
      const res = await api.lessonAudioStatus(lessonId!);
      // When the status flips out of NONE the lesson row has also
      // changed (transcript text written, audioUrl cleared) — invalidate
      // the lesson query so the editor picks up the suggestion.
      if (res.transcriptionStatus === 'DONE' || res.transcriptionStatus === 'FAILED') {
        await qc.invalidateQueries({ queryKey: ['lesson', lessonId] });
      }
      return res;
    },
    enabled: !!lessonId,
    refetchInterval: 1_500,
    refetchIntervalInBackground: false,
    staleTime: 500,
  });
}
