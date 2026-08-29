// #427 – FarmerProfile shows skeleton while loading, then renders data
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

const mockGetFarmer = vi.fn();

vi.mock('../api/client', () => ({
  api: { getFarmer: (...args) => mockGetFarmer(...args) },
}));

// Import after mock is set up
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

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/farmer/1']}>
      <Routes>
        <Route path="/farmer/:id" element={<FarmerProfile />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => vi.clearAllMocks());

test('renders skeleton (aria-busy) while loading', () => {
  let resolve;
  mockGetFarmer.mockReturnValue(new Promise(r => { resolve = r; }));

  renderProfile();

  expect(screen.getByLabelText(/loading farmer profile/i)).toBeTruthy();
  resolve({ data: mockFarmer });
});

test('renders farmer name after fetch resolves', async () => {
  mockGetFarmer.mockResolvedValue({ data: mockFarmer });

  renderProfile();

  await waitFor(() => screen.getByText('Jane Farm'));
  expect(screen.getByText('Jane Farm')).toBeTruthy();
});
