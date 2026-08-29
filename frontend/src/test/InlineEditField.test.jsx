import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import InlineEditField from '../components/dashboard/InlineEditField';

describe('InlineEditField', () => {
  it('renders the (formatted) value as text and enters edit mode on click', async () => {
    const user = userEvent.setup();
    render(<InlineEditField value={5} onSave={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('5');
    await user.click(screen.getByRole('button'));
    expect(screen.getByLabelText('Edit value')).toBeInTheDocument();
  });

  it('enters edit mode when the field is focused and Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<InlineEditField value={3} onSave={vi.fn()} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Edit value')).toBeInTheDocument();
  });

  it('commits the value on Enter and passes the parsed number (not a string)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEditField value={5} onSave={onSave} />);
    await user.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Edit value');
    await user.clear(input);
    await user.type(input, '7');
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe(7);
    expect(onSave.mock.calls[0][0]).not.toBe('7');
  });

  it('commits the value on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEditField value={10} onSave={onSave} />);
    await user.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Edit value');
    await user.clear(input);
    await user.type(input, '12.5');
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(12.5);
  });

  it('reverts the in-progress edit on Escape without calling onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEditField value={20} onSave={onSave} />);
    await user.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Edit value');
    await user.clear(input);
    await user.type(input, '99');
    await user.keyboard('{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('20');
  });

  it('passes a string value unchanged for non-number types', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEditField value="abc" type="text" onSave={onSave} />);
    await user.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Edit value');
    await user.clear(input);
    await user.type(input, 'xyz');
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledWith('xyz');
  });

  it('rejects an out-of-bounds value and reverts without calling onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEditField value={5} min={0} max={10} onSave={onSave} />);
    await user.click(screen.getByRole('button'));
    const input = screen.getByLabelText('Edit value');
    await user.clear(input);
    await user.type(input, '50');
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('5');
  });
});
