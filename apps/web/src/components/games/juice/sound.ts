/**
 * Game sound effects, synthesized with the Web Audio API.
 *
 * Why synthesis and not audio files: zero asset bytes (nothing to bundle
 * or precache for the PWA), fully offline, no licensing, and each cue is
 * a few lines to tune. The trade-off — less "produced" than sampled SFX
 * — is fine for short arcade blips.
 *
 * Autoplay policy: browsers won't let an AudioContext make sound until a
 * user gesture. `unlockAudio()` must be called from inside a real
 * tap/keydown handler (the engines wire it to the first interaction);
 * `playSound()` is a no-op until then.
 *
 * Mute is persisted in localStorage (`tutorly.sound`) and defaults ON.
 * It is independent of `prefers-reduced-motion` — muting sound and
 * calming motion are different needs.
 */
const STORAGE_KEY = 'tutorly.sound';

export type SoundKind = 'correct' | 'wrong' | 'pop' | 'levelup' | 'combo';

let ctx: AudioContext | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? w.webkitAudioContext;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // Private mode / disabled storage — keep the in-memory value.
  }
}

/** Create/resume the AudioContext. MUST run inside a user-gesture handler. */
export function unlockAudio(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

interface Tone {
  freq: number;
  type: OscillatorType;
  duration: number;
  sweepTo?: number;
  gain?: number;
}

// Short, distinct cues. Correct rises; wrong falls; pop is a quick chirp;
// level-up is a 3-note arpeggio; combo is a bright two-note sparkle.
const TONES: Record<SoundKind, Tone[]> = {
  correct: [
    { freq: 660, type: 'sine', duration: 0.1 },
    { freq: 880, type: 'sine', duration: 0.14 },
  ],
  pop: [{ freq: 520, type: 'triangle', duration: 0.09, sweepTo: 920 }],
  wrong: [{ freq: 200, type: 'sawtooth', duration: 0.2, sweepTo: 110 }],
  levelup: [
    { freq: 523, type: 'sine', duration: 0.11 },
    { freq: 659, type: 'sine', duration: 0.11 },
    { freq: 784, type: 'sine', duration: 0.2 },
  ],
  combo: [
    { freq: 880, type: 'square', duration: 0.07, gain: 0.04 },
    { freq: 1175, type: 'square', duration: 0.1, gain: 0.04 },
  ],
};

export function playSound(kind: SoundKind): void {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  let start = ctx.currentTime;
  for (const tone of TONES[kind]) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(tone.sweepTo, start + tone.duration);
    }
    const peak = tone.gain ?? 0.06;
    // exponentialRamp can't target 0, so floor at a near-silent value.
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + tone.duration + 0.02);
    start += tone.duration;
  }
}

/** Test hook: drop the context + re-read the persisted mute flag. */
export function __resetSound(): void {
  ctx = null;
  enabled = readEnabled();
}
