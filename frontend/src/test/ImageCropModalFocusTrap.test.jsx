import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ImageCropModal from '../components/ImageCropModal';

// Minimal 1×1 pixel data-URI so the img onLoad fires
const SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function renderModal(props = {}) {
  return render(
    <ImageCropModal
      src={SRC}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />
  );
}

describe('ImageCropModal – focus trap', () => {
  beforeEach(() => {
    // Provide a minimal canvas stub so the component doesn't blow up in jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has role="dialog", aria-modal="true", and aria-label on the container', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Crop Image');
  });

  it('moves focus into the dialog on mount', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
  });

  it('Tab cycles through focusable elements and never leaves the dialog', async () => {
    const user = userEvent.setup();
    renderModal();

    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    // Tab through every focusable element plus one extra wrap-around
    for (let i = 0; i <= focusable.length; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('Shift+Tab cycles backwards and never leaves the dialog', async () => {
    const user = userEvent.setup();
    renderModal();

    const dialog = screen.getByRole('dialog');

    for (let i = 0; i <= 3; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the trigger element on close', () => {
    // Create a button that will be the trigger
    const trigger = document.createElement('button');
    trigger.textContent = 'Open modal';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = renderModal();
    unmount();

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
