import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';

describe('ApiError', () => {
  it('captures status and body', () => {
    const err = new ApiError(429, 'Too many requests', { details: 'wait' });
    expect(err.status).toBe(429);
    expect(err.message).toBe('Too many requests');
    expect(err.body).toEqual({ details: 'wait' });
  });
});

describe('api.requestMagicLink (fetch wrapper)', () => {
  beforeEach(() => {
    // Reset cookie state between tests.
    document.cookie = 'tutor_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches credentials and CSRF header on POST', async () => {
    document.cookie = 'tutor_csrf=csrf-abc; path=/;';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { api } = await import('./api');
    await api.requestMagicLink({ email: 'a@b.co' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('csrf-abc');
    expect(headers['content-type']).toBe('application/json');
  });

  it('does not attach CSRF header on GET', async () => {
    document.cookie = 'tutor_csrf=csrf-abc; path=/;';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '1', email: 'a@b.co', name: null, locale: 'en' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { api } = await import('./api');
    await api.me();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-csrf-token']).toBeUndefined();
  });

  it('throws ApiError on non-2xx with parsed message', async () => {
    // Response bodies are single-use; mockImplementation returns a fresh one per call.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { api, ApiError: AE } = await import('./api');
    await expect(api.me()).rejects.toBeInstanceOf(AE);
    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const { api } = await import('./api');
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
