import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentTutorPayload } from '../../auth/current-tutor.decorator';
import { makeConfigStub } from '../../test/fixtures';
import type { GoogleIntegrationService } from './google-integration.service';
import { GoogleIntegrationController } from './google-integration.controller';
import type { OAuthStateService } from './oauth-state.service';

const tutorA: CurrentTutorPayload = { id: 'tutor_a', email: 'a@example.com', name: 'A', locale: 'en' };

function fakeReq() {
  return { ip: '127.0.0.1', header: () => undefined } as never;
}

function makeController(overrides: {
  integration?: Partial<GoogleIntegrationService>;
  state?: Partial<OAuthStateService>;
} = {}) {
  const integration = {
    buildAuthUrl: vi.fn().mockReturnValue('https://fake/?state=s'),
    completeConnect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ connected: false, lessonCalendarIds: [] }),
    listCalendars: vi.fn().mockResolvedValue({
      ok: true,
      items: [{ id: 'c1', summary: 'Cal' }],
    }),
    setLessonCalendarIds: vi.fn().mockResolvedValue({ lessonCalendarIds: ['c1'] }),
    ...overrides.integration,
  } as unknown as GoogleIntegrationService;
  const state = {
    issue: vi.fn().mockResolvedValue('state-abc'),
    consume: vi.fn().mockResolvedValue({ tutorId: 'tutor_a' }),
    ...overrides.state,
  } as unknown as OAuthStateService;
  const config = makeConfigStub();
  return {
    controller: new GoogleIntegrationController(integration, state, config),
    integration,
    state,
  };
}

describe('GoogleIntegrationController.connect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues OAuth state then returns authUrl', async () => {
    const { controller, integration, state } = makeController();
    const out = await controller.connect(tutorA);
    expect(state.issue).toHaveBeenCalledWith({ tutorId: 'tutor_a' });
    expect(integration.buildAuthUrl).toHaveBeenCalledWith({ state: 'state-abc' });
    expect(out.authUrl).toBe('https://fake/?state=s');
  });
});

describe('GoogleIntegrationController.callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing code', async () => {
    const { controller } = makeController();
    const res = { redirect: vi.fn() } as never;
    await expect(controller.callback(undefined, 'state-abc', undefined, fakeReq(), res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects missing state', async () => {
    const { controller } = makeController();
    const res = { redirect: vi.fn() } as never;
    await expect(controller.callback('code', undefined, undefined, fakeReq(), res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('redirects to the integrations page with error=… when Google returned an OAuth error', async () => {
    const { controller } = makeController();
    const res = { redirect: vi.fn() } as { redirect: ReturnType<typeof vi.fn> };
    await controller.callback(undefined, undefined, 'access_denied', fakeReq(), res as never);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      expect.stringContaining('/settings/integrations?connected=0&error=access_denied'),
    );
  });

  it('consumes state, exchanges code, redirects success', async () => {
    const { controller, state, integration } = makeController();
    const res = { redirect: vi.fn() } as { redirect: ReturnType<typeof vi.fn> };
    await controller.callback('code-1', 'state-abc', undefined, fakeReq(), res as never);
    expect(state.consume).toHaveBeenCalledWith({ state: 'state-abc' });
    expect(integration.completeConnect).toHaveBeenCalledWith(
      expect.objectContaining({ tutorId: 'tutor_a', code: 'code-1' }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      expect.stringContaining('/settings/integrations?connected=1'),
    );
  });
});

describe('GoogleIntegrationController.disconnect', () => {
  it('delegates to the service', async () => {
    const { controller, integration } = makeController();
    await controller.disconnect(tutorA, fakeReq());
    expect(integration.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({ tutorId: 'tutor_a' }),
    );
  });
});

describe('GoogleIntegrationController.listCalendars', () => {
  it('returns the calendar items on success', async () => {
    const { controller } = makeController();
    const out = await controller.listCalendars(tutorA);
    expect(out).toEqual({ items: [{ id: 'c1', summary: 'Cal' }] });
  });

  it('returns the typed error response on Google failure (not a 500)', async () => {
    const { controller } = makeController({
      integration: {
        listCalendars: vi.fn().mockResolvedValue({ ok: false, error: 'quota_exceeded' }),
      },
    });
    const out = await controller.listCalendars(tutorA);
    expect(out).toEqual({ error: 'quota_exceeded' });
  });
});

describe('GoogleIntegrationController.setLessonCalendars', () => {
  it('validates and delegates', async () => {
    const { controller, integration } = makeController();
    const out = await controller.setLessonCalendars(tutorA, { calendarIds: ['c1'] }, fakeReq());
    expect(integration.setLessonCalendarIds).toHaveBeenCalledWith(
      expect.objectContaining({ tutorId: 'tutor_a', calendarIds: ['c1'] }),
    );
    expect(out).toEqual({ lessonCalendarIds: ['c1'] });
  });

  it('rejects bad bodies', async () => {
    const { controller } = makeController();
    await expect(controller.setLessonCalendars(tutorA, {}, fakeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('GoogleIntegrationController.status', () => {
  it('returns the parsed status', async () => {
    const { controller } = makeController({
      integration: {
        status: vi.fn().mockResolvedValue({ connected: true, lessonCalendarIds: ['c1'] }),
      },
    });
    expect(await controller.status(tutorA)).toEqual({ connected: true, lessonCalendarIds: ['c1'] });
  });
});
