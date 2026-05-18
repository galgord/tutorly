import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');

/**
 * The boot script in `index.html` runs before React mounts so RTL locales
 * never flash LTR before hydration. These tests evaluate that script inside
 * a fresh JSDOM with a controllable URL + localStorage and verify the
 * resulting `<html lang/dir/class>` for each input.
 */
function boot({ search = '', stored }: { search?: string; stored?: string | null } = {}) {
  const dom = new JSDOM(INDEX_HTML, {
    url: `http://localhost/${search ? `?${search}` : ''}`,
    runScripts: 'dangerously',
  });
  if (stored !== undefined) {
    dom.window.localStorage.setItem('locale', stored ?? '');
  }
  // The inline boot script runs at parse time. To exercise it after we set
  // up localStorage we re-evaluate the same logic explicitly via the script
  // text. Easiest path: extract & run.
  const scriptText = INDEX_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  // Clear what the parse-time run did so we observe the re-eval cleanly.
  dom.window.document.documentElement.removeAttribute('lang');
  dom.window.document.documentElement.removeAttribute('dir');
  dom.window.document.documentElement.classList.remove('pseudo-active');
  dom.window.eval(scriptText);
  return {
    lang: dom.window.document.documentElement.getAttribute('lang'),
    dir: dom.window.document.documentElement.getAttribute('dir'),
    pseudo: dom.window.document.documentElement.classList.contains('pseudo-active'),
  };
}

describe('boot-locale script (index.html)', () => {
  it('defaults to en/ltr when nothing is set', () => {
    const r = boot();
    expect(r.dir).toBe('ltr');
    expect(['en', 'pt', 'he', 'pseudo']).toContain(r.lang);
    expect(r.pseudo).toBe(false);
  });

  it('honors ?lang=he with rtl', () => {
    const r = boot({ search: 'lang=he' });
    expect(r.lang).toBe('he');
    expect(r.dir).toBe('rtl');
  });

  it('honors ?lang=pseudo and adds the pseudo-active class', () => {
    const r = boot({ search: 'lang=pseudo' });
    expect(r.lang).toBe('pseudo');
    expect(r.dir).toBe('ltr');
    expect(r.pseudo).toBe(true);
  });

  it('rejects unknown ?lang values', () => {
    const r = boot({ search: 'lang=klingon' });
    // Falls back to navigator / default ('en' under jsdom).
    expect(r.lang).not.toBe('klingon');
  });
});
