import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="Test modal" testId="test-modal" {...props}>
      <p>Body content</p>
    </Modal>,
  );
  return { onClose };
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="X">
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders title, children, and a close button when open', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test modal')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByTestId('test-modal-close')).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByTestId('test-modal-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close on Escape when not dismissable', () => {
    const { onClose } = renderModal({ dismissable: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('backdrop click calls onClose', () => {
    const { onClose } = renderModal();
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking inside the panel does not close', () => {
    const { onClose } = renderModal();
    fireEvent.mouseDown(screen.getByText('Body content'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
