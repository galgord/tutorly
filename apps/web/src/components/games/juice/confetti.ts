/**
 * Confetti burst, lazily loaded so `canvas-confetti` never lands in the
 * entry chunk — it's only fetched the first time a student earns a
 * celebration. Symmetric origin (center) so it reads the same in LTR and
 * RTL. Callers must gate on `prefers-reduced-motion` (the juice hook
 * does).
 */
export type ConfettiKind = 'levelup' | 'combo';

export async function fireConfetti(kind: ConfettiKind = 'levelup'): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const confetti = (await import('canvas-confetti')).default;
    if (kind === 'combo') {
      void confetti({
        particleCount: 36,
        spread: 55,
        startVelocity: 28,
        ticks: 120,
        origin: { x: 0.5, y: 0.6 },
        scalar: 0.8,
      });
      return;
    }
    // level-up: a fuller, two-burst pop.
    void confetti({ particleCount: 80, spread: 70, origin: { x: 0.5, y: 0.55 } });
    window.setTimeout(() => {
      void confetti({ particleCount: 50, spread: 100, startVelocity: 35, origin: { x: 0.5, y: 0.5 } });
    }, 140);
  } catch {
    // Confetti is pure delight — never let a load failure break play.
  }
}
