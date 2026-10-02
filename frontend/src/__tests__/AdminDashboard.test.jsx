import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import { axe } from 'jest-axe';
import AdminDashboard from '../AdminDashboard';

test('ban requires confirmation through the accessible dialog', async () => {
  const onBan = vi.fn();
  const users = [{ id: 1, name: 'John', isBanned: false }];
  const { container } = render(<AdminDashboard users={users} onBan={onBan} />);

  fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
  let dialog = await screen.findByRole('alertdialog', { name: 'Ban John?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(onBan).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
  dialog = await screen.findByRole('alertdialog', { name: 'Ban John?' });
  expect(await axe(container)).toHaveNoViolations();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ban' }));
  await vi.waitFor(() => expect(onBan).toHaveBeenCalledWith(users[0]));
});
