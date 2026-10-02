import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { axe } from 'jest-axe';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';

describe('ConfirmDialog', () => {
  function renderDialog(props = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const utils = render(
      <ConfirmDialog
        title="Delete item?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    );
    return { ...utils, onConfirm, onCancel };
  }

  it('is a labelled, described alertdialog', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete item?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('has no axe violations', async () => {
    const { container } = renderDialog();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('focuses the cancel button and traps Tab inside the dialog', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(cancel).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('calls onCancel on Escape and onConfirm on confirm', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger when closed', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <ConfirmDialog open={open} title="Sure?" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });
});

describe('useConfirm', () => {
  function Harness({ onResult }) {
    const { confirm, confirmDialog } = useConfirm();
    return (
      <>
        <button onClick={async () => onResult(await confirm({ title: 'Proceed?', confirmLabel: 'Yes' }))}>Ask</button>
        {confirmDialog}
      </>
    );
  }

  it('resolves true when confirmed and false when cancelled', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resolves false if the component unmounts while pending', async () => {
    const onResult = vi.fn();
    const { unmount } = render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('alertdialog');
    await act(async () => unmount());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
