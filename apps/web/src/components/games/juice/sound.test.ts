import { beforeEach, describe, expect, it } from 'vitest';
import { __resetSound, isSoundEnabled, playSound, setSoundEnabled, unlockAudio } from './sound';

describe('sound (Web Audio synth)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetSound();
  });

  it('defaults to enabled when nothing is persisted', () => {
    expect(isSoundEnabled()).toBe(true);
  });

  it('persists the mute flag to localStorage and reads it back', () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(window.localStorage.getItem('tutorly.sound')).toBe('off');
    setSoundEnabled(true);
    expect(window.localStorage.getItem('tutorly.sound')).toBe('on');
  });

  it('honors a persisted "off" after a reset', () => {
    window.localStorage.setItem('tutorly.sound', 'off');
    __resetSound();
    expect(isSoundEnabled()).toBe(false);
  });

  it('playSound is a safe no-op without an AudioContext (jsdom)', () => {
    expect(() => playSound('correct')).not.toThrow();
  });

  it('unlockAudio is a safe no-op when AudioContext is unsupported', () => {
    expect(() => unlockAudio()).not.toThrow();
  });
});
