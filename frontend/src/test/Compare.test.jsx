import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

describe('Compare export (#782)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('disables Export CSV and Print buttons when comparison set is empty', () => {
    useCompare.mockReturnValue({ products: [] });
    render(<Compare />);
    expect(screen.getByText('Export CSV')).toBeDisabled();
    expect(screen.getByText('Print / Save as PDF')).toBeDisabled();
  });

  it('enables Export CSV and Print buttons when there are compared products', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });
    render(<Compare />);
    expect(screen.getByText('Export CSV')).not.toBeDisabled();
    expect(screen.getByText('Print / Save as PDF')).not.toBeDisabled();
  });

  it('calls window.print when Print / Save as PDF is clicked', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });
    const printSpy = vi.fn();
    window.print = printSpy;
    render(<Compare />);
    fireEvent.click(screen.getByText('Print / Save as PDF'));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call window.print when Print button is disabled (empty set)', () => {
    useCompare.mockReturnValue({ products: [] });
    const printSpy = vi.fn();
    window.print = printSpy;
    render(<Compare />);
    fireEvent.click(screen.getByText('Print / Save as PDF'));
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('builds a CSV Blob with product names as columns and attributes as rows, then downloads it', () => {
    useCompare.mockReturnValue({ products: [fullProduct, minimalProduct] });

    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    const clickSpy = vi.fn();
    const anchor = { click: clickSpy, href: '', download: '' };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (
      tag === 'a' ? anchor : originalCreateElement(tag)
    ));

    render(<Compare />);
    fireEvent.click(screen.getByText('Export CSV'));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe('text/csv');

    expect(anchor.download).toBe('product-comparison.csv');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');

    document.createElement.mockRestore();
  });

  it('does not export CSV when the comparison set is empty', () => {
    useCompare.mockReturnValue({ products: [] });

    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    window.URL.createObjectURL = createObjectURLSpy;

    render(<Compare />);
    fireEvent.click(screen.getByText('Export CSV'));

    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });
});
