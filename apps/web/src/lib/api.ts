import type {
  CalendarMergeResponse,
  CalendarRangeQuery,
  ConnectIntegrationResponse,
  CreateGameRequest,
  CreateLessonRequest,
  CreateStudentRequest,
  FinishAttemptResponse,
  GameListResponse,
  GameResponse,
  IntegrationErrorResponse,
  IntegrationStatusResponse,
  LessonListResponse,
  LessonResponse,
  ListCalendarsResponse,
  ListLessonsQuery,
  ListStudentsQuery,
  MagicLinkRequest,
  MagicLinkResponse,
  MeResponse,
  AttemptHistoryResponse,
  PublicStudentDashboardResponse,
  PublicStudentResponse,
  StudentProgressResponse,
  StudentGameProgressResponse,
  StudentGamesResponse,
  RegenerateQuestionRequest,
  RotateTokenResponse,
  StartAttemptResponse,
  StudentListResponse,
  StudentResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  TranscriptionStatusResponse,
  UpdateFeedbackRequest,
  UpdateGameRequest,
  UpdateLessonCalendarsRequest,
  UpdateStudentRequest,
  UpdateTutorRequest,
} from '@tutor-app/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const CSRF_COOKIE = 'tutor_csrf';
const CSRF_HEADER = 'x-csrf-token';

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

function buildListPath(base: string, query?: ListStudentsQuery): string {
  if (!query) return base;
  const sp = new URLSearchParams();
  if (query.q) sp.set('q', query.q);
  if (query.page != null) sp.set('page', String(query.page));
  if (query.limit != null) sp.set('limit', String(query.limit));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

export const api = {
  requestMagicLink: (body: MagicLinkRequest): Promise<MagicLinkResponse> =>
    request('/auth/magic-link', { method: 'POST', body }),
  me: (): Promise<MeResponse> => request('/me'),
  updateMe: (body: UpdateTutorRequest): Promise<MeResponse> =>
    request('/me', { method: 'PATCH', body }),
  deleteMe: (): Promise<void> => request('/me', { method: 'DELETE' }),
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),

  // Students --------------------------------------------------------------
  listStudents: (query?: ListStudentsQuery): Promise<StudentListResponse> =>
    request(buildListPath('/students', query)),
  getStudent: (id: string): Promise<StudentResponse> => request(`/students/${encodeURIComponent(id)}`),
  createStudent: (body: CreateStudentRequest): Promise<StudentResponse> =>
    request('/students', { method: 'POST', body }),
  updateStudent: (id: string, body: UpdateStudentRequest): Promise<StudentResponse> =>
    request(`/students/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteStudent: (id: string): Promise<void> =>
    request(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreStudent: (id: string): Promise<StudentResponse> =>
    request(`/students/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  rotateStudentToken: (id: string): Promise<RotateTokenResponse> =>
    request(`/students/${encodeURIComponent(id)}/rotate-token`, { method: 'POST' }),
  listTrashStudents: (query?: ListStudentsQuery): Promise<StudentListResponse> =>
    request(buildListPath('/trash/students', query)),
  studentProgress: (id: string): Promise<StudentProgressResponse> =>
    request(`/students/${encodeURIComponent(id)}/progress`),
  studentGameProgress: (id: string): Promise<StudentGameProgressResponse> =>
    request(`/students/${encodeURIComponent(id)}/game-progress`),
  listStudentAttempts: (
    id: string,
    query?: { page?: number; limit?: number },
  ): Promise<AttemptHistoryResponse> => {
    const sp = new URLSearchParams();
    if (query?.page != null) sp.set('page', String(query.page));
    if (query?.limit != null) sp.set('limit', String(query.limit));
    const s = sp.toString();
    return request(`/students/${encodeURIComponent(id)}/attempts${s ? `?${s}` : ''}`);
  },

  // Public (token-based) --------------------------------------------------
  publicStudent: (shareToken: string): Promise<PublicStudentResponse> =>
    request(`/s/${encodeURIComponent(shareToken)}/student`),
  publicStudentDashboard: (shareToken: string): Promise<PublicStudentDashboardResponse> =>
    request(`/s/${encodeURIComponent(shareToken)}/dashboard`),
  startAttempt: (shareToken: string, gameId: string): Promise<StartAttemptResponse> =>
    request(
      `/s/${encodeURIComponent(shareToken)}/games/${encodeURIComponent(gameId)}/attempts`,
      { method: 'POST', body: {} },
    ),
  submitAttemptAnswer: (
    shareToken: string,
    attemptId: string,
    body: SubmitAnswerRequest,
  ): Promise<SubmitAnswerResponse> =>
    request(
      `/s/${encodeURIComponent(shareToken)}/attempts/${encodeURIComponent(attemptId)}/answers`,
      { method: 'PATCH', body },
    ),
  finishAttempt: (shareToken: string, attemptId: string): Promise<FinishAttemptResponse> =>
    request(
      `/s/${encodeURIComponent(shareToken)}/attempts/${encodeURIComponent(attemptId)}/finish`,
      { method: 'POST', body: {} },
    ),

  // Lessons ---------------------------------------------------------------
  listLessons: (query: ListLessonsQuery): Promise<LessonListResponse> => {
    const sp = new URLSearchParams({
      studentId: query.studentId,
      page: String(query.page ?? 1),
      limit: String(query.limit ?? 20),
    });
    return request(`/lessons?${sp.toString()}`);
  },
  getLesson: (id: string): Promise<LessonResponse> =>
    request(`/lessons/${encodeURIComponent(id)}`),
  createLesson: (body: CreateLessonRequest): Promise<LessonResponse> =>
    request('/lessons', { method: 'POST', body }),
  deleteLesson: (id: string): Promise<void> =>
    request(`/lessons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreLesson: (id: string): Promise<LessonResponse> =>
    request(`/lessons/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  calendarMerge: (query: CalendarRangeQuery): Promise<CalendarMergeResponse> => {
    const sp = new URLSearchParams({ from: query.from, to: query.to });
    return request(`/lessons/calendar?${sp.toString()}`);
  },
  setLessonFeedback: (id: string, body: UpdateFeedbackRequest): Promise<LessonResponse> =>
    request(`/lessons/${encodeURIComponent(id)}/feedback`, { method: 'PATCH', body }),

  // Voice (Phase 5) ------------------------------------------------------
  uploadLessonAudio: async (
    id: string,
    opts: { blob: Blob; durationSeconds: number; fileName?: string },
  ): Promise<TranscriptionStatusResponse> => {
    const form = new FormData();
    form.append('audio', opts.blob, opts.fileName ?? 'audio.webm');
    form.append('durationSeconds', String(Math.ceil(opts.durationSeconds)));
    const csrf = readCsrfToken();
    const headers: Record<string, string> = {};
    if (csrf) headers[CSRF_HEADER] = csrf;
    const res = await fetch(`${API_BASE}/lessons/${encodeURIComponent(id)}/audio`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    });
    if (res.status === 204) return undefined as never;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const message =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw new ApiError(res.status, message, data);
    }
    return data as TranscriptionStatusResponse;
  },
  lessonAudioStatus: (id: string): Promise<TranscriptionStatusResponse> =>
    request(`/lessons/${encodeURIComponent(id)}/audio`),

  // Games -----------------------------------------------------------------
  listGames: (lessonId: string): Promise<GameListResponse> =>
    request(`/lessons/${encodeURIComponent(lessonId)}/games`),
  createGame: (lessonId: string, body: CreateGameRequest): Promise<GameResponse> =>
    request(`/lessons/${encodeURIComponent(lessonId)}/games`, { method: 'POST', body }),
  getGame: (id: string): Promise<GameResponse> =>
    request(`/games/${encodeURIComponent(id)}`),
  listStudentGames: (studentId: string): Promise<StudentGamesResponse> =>
    request(`/students/${encodeURIComponent(studentId)}/games`),
  updateGame: (id: string, body: UpdateGameRequest): Promise<GameResponse> =>
    request(`/games/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  regenerateGame: (id: string): Promise<GameResponse> =>
    request(`/games/${encodeURIComponent(id)}/regenerate`, { method: 'POST', body: {} }),
  regenerateGameQuestion: (id: string, body: RegenerateQuestionRequest): Promise<GameResponse> =>
    request(`/games/${encodeURIComponent(id)}/regenerate-question`, { method: 'POST', body }),
  assignGame: (id: string): Promise<GameResponse> =>
    request(`/games/${encodeURIComponent(id)}/assign`, { method: 'POST', body: {} }),
  deleteGame: (id: string): Promise<void> =>
    request(`/games/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Integrations: Google Calendar ----------------------------------------
  integrationStatus: (): Promise<IntegrationStatusResponse> =>
    request('/integrations/google/status'),
  integrationConnect: (): Promise<ConnectIntegrationResponse> =>
    request('/integrations/google/connect', { method: 'POST', body: {} }),
  integrationDisconnect: (): Promise<void> =>
    request('/integrations/google/disconnect', { method: 'DELETE' }),
  integrationListCalendars: (): Promise<ListCalendarsResponse | IntegrationErrorResponse> =>
    request('/integrations/google/calendars'),
  integrationSetLessonCalendars: (
    body: UpdateLessonCalendarsRequest,
  ): Promise<{ lessonCalendarIds: string[] }> =>
    request('/integrations/google/lesson-calendars', { method: 'PATCH', body }),
  // Test-only seed route — non-prod ONLY. Lets Playwright fake an oauth connect.
  testSeedGoogleConnection: (body?: {
    calendarIds?: string[];
    events?: unknown[];
  }): Promise<{ ok: true; connected: true; lessonCalendarIds: string[] }> =>
    request('/__test__/google/fake-tokens', { method: 'POST', body: body ?? {} }),
};
