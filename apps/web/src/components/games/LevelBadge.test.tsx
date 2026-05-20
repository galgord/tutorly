import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelBadge, ReviewMarker } from './LevelBadge';

describe('LevelBadge', () => {
  it('renders "Level N/max" and exposes the level via a data attribute', () => {
    render(<LevelBadge level={3} levelMax={5} />);
    const el = screen.getByTestId('play-level');
    expect(el).toHaveTextContent('Level 3/5');
    expect(el).toHaveAttribute('data-level', '3');
  });

  it('defaults the max to 5 when not provided', () => {
    render(<LevelBadge level={2} />);
    expect(screen.getByTestId('play-level')).toHaveTextContent('Level 2/5');
  });
});

describe('ReviewMarker', () => {
  it('renders the "seen before" review chip', () => {
    render(<ReviewMarker />);
    expect(screen.getByTestId('play-review-marker')).toHaveTextContent('Seen before');
  });
});
