import { z } from 'zod';

export const LocaleSchema = z.enum(['en', 'pt', 'he']);

// Phase 11 — see `Language` in `types/index.ts` for the distinction from
// `Locale`. Kept in sync manually with `SUPPORTED_LANGUAGES`.
export const LanguageSchema = z.enum(['en', 'pt', 'he', 'es', 'fr', 'de', 'it', 'ar']);
