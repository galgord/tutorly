import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sound', () => ({
  isSoundEnabled: vi.fn(() => true),
  setSoundEnabled: vi.fn(),
  unlockAudio: vi.fn(),
}));
import { isSoundEnabled, setSoundEnabled, unlockAudio } from './sound';
import { SoundToggle } from './SoundToggle';

describe('SoundToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSoundEnabled).mockReturnValue(true);
  });

  it('reflects the persisted state (on by default) via aria-pressed', () => {
    render(<SoundToggle />);
    expect(screen.getByTestId('play-sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('muting persists off and does not unlock audio', () => {
    render(<SoundToggle />);
    fireEvent.click(screen.getByTestId('play-sound-toggle'));
    expect(vi.mocked(setSoundEnabled)).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('play-sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(vi.mocked(unlockAudio)).not.toHaveBeenCalled();
  });

  it('unmuting persists on and unlocks audio (the click is a user gesture)', () => {
    vi.mocked(isSoundEnabled).mockReturnValue(false);
    render(<SoundToggle />);
    expect(screen.getByTestId('play-sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('play-sound-toggle'));
    expect(vi.mocked(setSoundEnabled)).toHaveBeenCalledWith(true);
    expect(vi.mocked(unlockAudio)).toHaveBeenCalled();
    expect(screen.getByTestId('play-sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
});
