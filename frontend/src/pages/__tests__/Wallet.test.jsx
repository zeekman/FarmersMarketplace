import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Wallet from '../Wallet';
import api from '../../services/client';

jest.mock('../../services/client', () => ({
  __esModule: true,
  default: {
    getBalance: jest.fn(),
    sendXLM: jest.fn(),
    withdrawFunds: jest.fn(),
    resolveFederation: jest.fn(),
  },
}));

const DESTINATION = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const FEDERATION = 'alice*example.com';
const RESOLVED_KEY = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

beforeEach(() => {
  jest.clearAllMocks();
  api.getBalance.mockResolvedValue({ balance: '100.0000000', subentries: 0 });
  api.sendXLM.mockResolvedValue({ hash: 'abc123' });
  api.resolveFederation.mockResolvedValue({ address: RESOLVED_KEY, memo: '12345' });
});

async function fillAndSubmit({ destination = DESTINATION, amount = '10', memo = '' } = {}) {
  render(<Wallet />);
  await waitFor(() => expect(api.getBalance).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: destination } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: amount } });
  if (memo) {
    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: memo } });
  }
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('Wallet send form', () => {
  it('sends the memo via api.sendXLM instead of the withdraw endpoint', async () => {
    await fillAndSubmit({ memo: 'exchange-memo' });

    await waitFor(() => expect(api.sendXLM).toHaveBeenCalledTimes(1));
    expect(api.sendXLM).toHaveBeenCalledWith({
      destination: DESTINATION,
      amount: '10',
      memo: 'exchange-memo',
    });
    expect(api.withdrawFunds).not.toHaveBeenCalled();
  });

  it('resolves a federation address before submitting and shows the resolved key', async () => {
    await fillAndSubmit({ destination: FEDERATION, memo: '' });

    await waitFor(() => expect(api.resolveFederation).toHaveBeenCalledWith(FEDERATION));
    await waitFor(() => expect(api.sendXLM).toHaveBeenCalledTimes(1));

    expect(api.sendXLM).toHaveBeenCalledWith({
      destination: RESOLVED_KEY,
      amount: '10',
      memo: '12345',
    });
    expect(await screen.findByText(new RegExp(RESOLVED_KEY))).toBeInTheDocument();
  });

  it('blocks submission when the amount exceeds the spendable balance', async () => {
    api.getBalance.mockResolvedValue({ balance: '2.0000000', subentries: 0 });

    await fillAndSubmit({ amount: '2' });

    await waitFor(() =>
      expect(screen.getByText(/insufficient|spendable/i)).toBeInTheDocument()
    );
    expect(api.sendXLM).not.toHaveBeenCalled();
  });
});
