import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScorePop } from './ScorePop';

describe('ScorePop', () => {
  it('renders the points it is given, with a + prefix', () => {
    render(<ScorePop points={50} />);
    const el = screen.getByTestId('play-score-pop');
    expect(el).toHaveTextContent('+50');
  });

  it('is decorative — aria-hidden and pointer-events-none', () => {
    render(<ScorePop points={10} />);
    const el = screen.getByTestId('play-score-pop');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('pointer-events-none');
  });

  it('formats large deltas via Intl and never derives its own value', () => {
    render(<ScorePop points={1234} />);
    // en grouping → 1,234. The component only renders what it's handed.
    expect(screen.getByTestId('play-score-pop')).toHaveTextContent('+1,234');
  });
});
