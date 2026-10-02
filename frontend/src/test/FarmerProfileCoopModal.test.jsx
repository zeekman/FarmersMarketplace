// #1373 – FarmerProfile parses and the cooperative detail modal opens/closes
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

const mockGetFarmer = vi.fn();
const mockGetFarmerCooperatives = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    getFarmer: (...args) => mockGetFarmer(...args),
    getBatchesByFarmer: () => Promise.resolve({ data: [] }),
    getFarmerCooperatives: (...args) => mockGetFarmerCooperatives(...args),
  },
}));

const { default: FarmerProfile } = await import('../pages/FarmerProfile');

const mockFarmer = {
  id: 1,
  name: 'Jane Farm',
  location: 'Nairobi',
  bio: 'Organic produce',
  avatar_url: null,
  created_at: '2023-01-01T00:00:00Z',
  listings: [],
};

const mockCoop = {
  id: 7,
  name: 'Green Valley Growers',
  description: 'A collective of smallholder farmers',
  member_count: 12,
  created_at: '2022-03-01T00:00:00Z',
};

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/farmer/1']}>
      <Routes>
        <Route path="/farmer/:id" element={<FarmerProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetFarmer.mockResolvedValue({ data: mockFarmer });
  mockGetFarmerCooperatives.mockResolvedValue({ data: [mockCoop] });
});

afterEach(() => vi.clearAllMocks());

async function openCoopModal() {
  renderProfile();
  const badge = await screen.findByLabelText(/member of cooperative: green valley growers/i);
  fireEvent.click(badge);
  return screen.getByRole('dialog');
}

test('opens the coop modal with cooperative details', async () => {
  const dialog = await openCoopModal();
  expect(dialog).toHaveTextContent('Green Valley Growers');
  expect(dialog).toHaveTextContent('A collective of smallholder farmers');
  expect(dialog).toHaveTextContent('12 members');
});

test('closes the coop modal via the Close button', async () => {
  await openCoopModal();
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('closes the coop modal on Escape', async () => {
  await openCoopModal();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('closes the coop modal on backdrop click', async () => {
  const dialog = await openCoopModal();
  fireEvent.click(dialog);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
