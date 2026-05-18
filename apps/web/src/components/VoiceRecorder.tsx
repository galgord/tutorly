import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VOICE_MAX_DURATION_SECONDS, type TranscriptionStatusResponse } from '@tutor-app/shared';
import { ApiError } from '../lib/api';
import { useLessonAudioStatus, useUploadLessonAudio } from '../lib/voice';
import { Toast } from './Toast';

interface Props {
  lessonId: string;
  /** Server-side transcription status as of the last lesson fetch. Drives
   *  whether the recorder is in idle / recording / transcribing / done state. */
  initialStatus: TranscriptionStatusResponse['transcriptionStatus'];
  /** Server-side transcription error, if any. */
  initialError: string | null;
  /** Called once the transcription completes so the parent can refresh
   *  the lesson + populate the FeedbackEditor with the suggested text. */
  onTranscriptionDone?: () => void;
  /** Disable recording while another transcription is in progress on the
   *  same lesson, or when the tutor has unsaved text feedback. */
  disabled?: boolean;
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'uploading';

/**
 * In-browser MediaRecorder-based voice recorder. Tutor records up to
 * 5 minutes; on stop, the resulting Blob is multipart-uploaded to the
 * api which kicks off a Whisper job. The component then polls the
 * transcription status endpoint until the job lands; on success the
 * parent re-fetches the lesson and the FeedbackEditor pre-fills with
 * the suggested transcript.
 *
 * RTL-correct via Tailwind logical utilities (ms-/me-, start-/end-).
 * The transcript display itself is owned by `FeedbackEditor` (using
 * dir="auto" so the direction follows the content).
 */
export function VoiceRecorder({
  lessonId,
  initialStatus,
  initialError,
  onTranscriptionDone,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const upload = useUploadLessonAudio(lessonId);
  const statusQuery = useLessonAudioStatus(lessonId, initialStatus);
  // Trust the polling result when present, otherwise fall back to the
  // server snapshot the parent passed in.
  const liveStatus = statusQuery.data?.transcriptionStatus ?? initialStatus;
  const liveError = statusQuery.data?.transcriptionError ?? initialError;
  const previousStatusRef = useRef(liveStatus);
  useEffect(() => {
    // Fire onTranscriptionDone exactly once when status transitions
    // from in-flight → DONE so the parent re-fetches the lesson.
    if (
      previousStatusRef.current !== 'DONE' &&
      liveStatus === 'DONE' &&
      onTranscriptionDone
    ) {
      onTranscriptionDone();
    }
    previousStatusRef.current = liveStatus;
  }, [liveStatus, onTranscriptionDone]);

  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  /** Clean up any active stream + timer. Safe to call repeatedly. */
  const stopStreams = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  // Always release the mic + clear timers when the component unmounts.
  useEffect(() => {
    return () => {
      stopStreams();
    };
  }, [stopStreams]);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('voice.error.noMediaApi'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Prefer opus@16kHz mono via audioBitsPerSecond. Browsers that
      // ignore the codec hint still produce a webm container we accept.
      const options: MediaRecorderOptions = {
        mimeType: chooseMimeType(),
        audioBitsPerSecond: 24_000,
      };
      const rec = new MediaRecorder(stream, options);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        // Compute final blob; the upload effect picks it up via state.
        setRecorderState('stopped');
      };
      rec.start(1_000); // emit a chunk every second so we can show waveform
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecorderState('recording');
      timerRef.current = window.setInterval(() => {
        if (startedAtRef.current === null) return;
        const ms = Date.now() - startedAtRef.current;
        setElapsedMs(ms);
        if (ms / 1_000 >= VOICE_MAX_DURATION_SECONDS) {
          // Stop at cap.
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        }
      }, 200);
    } catch (err) {
      setError(t('voice.error.micDenied'));
      // Diagnostic only — don't leak the raw DOM error to the user.
      console.warn('mic getUserMedia failed:', (err as Error).message);
    }
  }, [t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const resetRecording = useCallback(() => {
    stopStreams();
    chunksRef.current = [];
    startedAtRef.current = null;
    setElapsedMs(0);
    setError(null);
    setRecorderState('idle');
  }, [stopStreams]);

  const submitRecording = useCallback(async () => {
    if (chunksRef.current.length === 0) {
      setError(t('voice.error.empty'));
      return;
    }
    const blob = new Blob(chunksRef.current, { type: chooseMimeType() });
    const durationSeconds = Math.max(1, Math.round(elapsedMs / 1_000));
    setRecorderState('uploading');
    try {
      await upload.mutateAsync({
        blob,
        durationSeconds,
        fileName: `lesson-${lessonId}.webm`,
      });
      // Clear local buffer once handed off; the status poll takes over.
      chunksRef.current = [];
      startedAtRef.current = null;
      setRecorderState('idle');
      setToast(t('voice.toast.uploaded'));
    } catch (err) {
      const friendly =
        err instanceof ApiError
          ? err.status === 413
            ? t('voice.error.tooLarge')
            : err.status === 403
              ? t('voice.error.quota')
              : err.status === 400
                ? t('voice.error.rejected')
                : t('voice.error.uploadFailed')
          : t('voice.error.uploadFailed');
      setError(friendly);
      setRecorderState('stopped');
    }
  }, [elapsedMs, lessonId, t, upload]);

  const isInFlightOnServer = liveStatus === 'PENDING' || liveStatus === 'TRANSCRIBING';
  const isFailedOnServer = liveStatus === 'FAILED';
  const isDoneOnServer = liveStatus === 'DONE';
  const canStart =
    !disabled &&
    !isInFlightOnServer &&
    (recorderState === 'idle' || recorderState === 'stopped');

  const formattedElapsed = formatElapsed(elapsedMs);
  const remainingPct = Math.min(100, (elapsedMs / 1_000 / VOICE_MAX_DURATION_SECONDS) * 100);

  return (
    <section
      data-testid="voice-recorder"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <header>
        <h2 className="text-lg font-semibold">{t('voice.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('voice.subtitle')}</p>
      </header>

      {/* Mic-denied / unsupported empty state */}
      {error && (
        <p
          role="alert"
          data-testid="voice-error"
          className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
        >
          {error}
        </p>
      )}

      {/* Transcription in flight (server-reported) */}
      {isInFlightOnServer && (
        <div
          data-testid="voice-status-transcribing"
          className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {liveStatus === 'PENDING'
            ? t('voice.status.pending')
            : t('voice.status.transcribing')}
        </div>
      )}

      {/* Transcription failure */}
      {isFailedOnServer && (
        <div
          role="alert"
          data-testid="voice-status-failed"
          className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
        >
          <p className="font-medium">{t('voice.status.failedTitle')}</p>
          <p className="mt-1">
            {liveError === 'WHISPER_UNAVAILABLE_CIRCUIT_OPEN' ||
            liveError === 'WHISPER_UNAVAILABLE'
              ? t('voice.status.failedUnavailable')
              : t('voice.status.failedGeneric')}
          </p>
        </div>
      )}

      {/* Done indicator (transient — parent should hide once feedback saved) */}
      {isDoneOnServer && (
        <p
          data-testid="voice-status-done"
          className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {t('voice.status.done')}
        </p>
      )}

      {/* Recording controls */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {recorderState === 'idle' && (
          <button
            type="button"
            onClick={startRecording}
            disabled={!canStart}
            className="rounded bg-rose-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            data-testid="voice-start"
          >
            {t('voice.start')}
          </button>
        )}

        {recorderState === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            data-testid="voice-stop"
          >
            {t('voice.stop')}
          </button>
        )}

        {recorderState === 'stopped' && (
          <>
            <button
              type="button"
              onClick={submitRecording}
              disabled={upload.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              data-testid="voice-submit"
            >
              {upload.isPending ? t('common.workingOn') : t('voice.submit')}
            </button>
            <button
              type="button"
              onClick={resetRecording}
              disabled={upload.isPending}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              data-testid="voice-reset"
            >
              {t('voice.reset')}
            </button>
          </>
        )}

        {recorderState === 'uploading' && (
          <span
            data-testid="voice-uploading"
            className="text-sm text-slate-600"
          >
            {t('voice.uploading')}
          </span>
        )}
      </div>

      {/* Waveform proxy: simple elapsed bar (visually flows start→end in
          both LTR and RTL via logical inline-end). */}
      {(recorderState === 'recording' || recorderState === 'stopped') && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span data-testid="voice-elapsed">{formattedElapsed}</span>
            <span>{formatElapsed(VOICE_MAX_DURATION_SECONDS * 1_000)}</span>
          </div>
          <div
            className="mt-1 h-2 w-full overflow-hidden rounded bg-slate-200"
            data-testid="voice-progress"
          >
            <div
              className="h-full bg-rose-600"
              style={{ inlineSize: `${remainingPct}%` }}
            />
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} testId="voice-toast" />}
    </section>
  );
}

function chooseMimeType(): string {
  // Prefer webm/opus everywhere it's supported (Chrome/Firefox/Edge).
  // Safari needs mp4 fallback; check before requesting.
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return 'audio/webm';
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
