import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../context/CompareContext', () => ({
  useCompare: vi.fn(),
}));

vi.mock('../components/StarRating', () => ({
  default: ({ value, count }) => <span>{value} ({count})</span>,
}));

import { useCompare } from '../context/CompareContext';
import Compare from '../pages/Compare';

const fullProduct = {
  id: 1,
  name: 'Tomatoes',
  farmer_name: 'Alice',
  price: 2.5,
  quantity: 10,
  unit: 'kg',
  review_count: 5,
  avg_rating: 4.2,
  category: 'Vegetables',
};

const minimalProduct = {
  id: 2,
  name: 'Mystery Box',
  farmer_name: null,
  price: null,
  quantity: null,
  unit: null,
  review_count: 0,
  avg_rating: null,
  category: null,
};

describe('Compare optional chaining (#426)', () => {
  it('renders without crashing when a product has null fields', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });
    expect(() => render(<Compare />)).not.toThrow();
  });

  it('shows "—" placeholder for missing fields', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });
    render(<Compare />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders full product data correctly', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });
    render(<Compare />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('2.5 XLM')).toBeInTheDocument();
    expect(screen.getByText('Vegetables')).toBeInTheDocument();
  });
});
