import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InlineEditField from '../../components/dashboard/InlineEditField';

// ── InlineEditField unit tests ────────────────────────────────────────────────

describe('InlineEditField', () => {
  it('renders the formatted value as plain text', () => {
    render(<InlineEditField value={2.5} format={(v) => `${v} XLM`} onSave={jest.fn()} />);
    expect(screen.getByText('2.5 XLM')).toBeInTheDocument();
  });

  it('switches to an input on click', () => {
    render(<InlineEditField value={2.5} onSave={jest.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('happy path — Enter submits and calls onSave with new value', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={2.5} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '5' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSave).toHaveBeenCalledWith(5);
    // Back to display mode
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('happy path — Tab also submits', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={10} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '20' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Tab' });
    });
    expect(onSave).toHaveBeenCalledWith(20);
  });

  it('cancel — Escape restores original value without calling onSave', () => {
    const onSave = jest.fn();
    render(<InlineEditField value={2.5} format={(v) => `${v} XLM`} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('2.5 XLM')).toBeInTheDocument();
  });

  it('error revert — onSave rejection calls onError and reverts to display', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Network error'));
    const onError = jest.fn();
    render(<InlineEditField value={2.5} onSave={onSave} onError={onError} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '99' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onError).toHaveBeenCalledWith('Network error');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('does not call onSave when value is unchanged', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={2.5} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('spinbutton');
    // Keep value the same
    fireEvent.change(input, { target: { value: '2.5' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('respects min — submits nothing below min', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={5} type="number" min={1} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-1' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  // #1030 — max prop
  it('respects max — reverts field when value exceeds max', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={5} type="number" max={100} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '999' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    });
    expect(onSave).not.toHaveBeenCalled();
    // back to display mode (reverted)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('accepts a value exactly at max', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<InlineEditField value={5} type="number" max={100} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    });
    expect(onSave).toHaveBeenCalledWith(100);
  });

  // #1029 — Tab must NOT call preventDefault (focus advances)
  it('Tab commits but does not call preventDefault — focus can advance', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <div>
        <InlineEditField value={10} onSave={onSave} />
        <button data-testid="next-field">Next</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /click to edit/i }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '20' } });

    // Simulate Tab key — defaultPrevented must remain false
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      input.dispatchEvent(tabEvent);
    });

    expect(tabEvent.defaultPrevented).toBe(false);
    expect(onSave).toHaveBeenCalledWith(20);
  });
});
