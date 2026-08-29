import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { ...actual.api, uploadProductImage: vi.fn(), createProduct: vi.fn() } };
});
vi.mock('../utils/useXlmRate', () => ({ useXlmRate: () => ({ usd: () => '' }) }));
vi.mock('../components/ImageCropModal', () => ({
  default: ({ onConfirm, onCancel }) => (
    <div role="dialog" aria-label="Crop Image">
      <button onClick={() => onConfirm(new Blob(['cropped'], { type: 'image/jpeg' }))}>Use Crop</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import ProductForm from '../components/dashboard/ProductForm';
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  api.uploadProductImage.mockResolvedValue({ imageUrl: '/uploads/product.jpg' });
  api.createProduct.mockResolvedValue({});
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:product');
});

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Fresh Tomatoes' } });
  fireEvent.change(screen.getByLabelText('Price (XLM)'), { target: { value: '12.5' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8' } });
}

describe('ProductForm', () => {
  it('shows validation errors for an incomplete preorder date', () => {
    render(<ProductForm harvestBatches={[]} />);
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/mark as pre-order/i));
    fireEvent.submit(screen.getByRole('button', { name: /list product/i }).closest('form'));
    expect(screen.getByRole('alert')).toHaveTextContent(/YYYY-MM-DD/);
  });

  it('opens the crop modal for a picked image and uploads the cropped file', async () => {
    render(<ProductForm harvestBatches={[]} />);
    const file = new File(['image'], 'tomatoes.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(screen.getByRole('dialog', { name: /crop image/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use crop/i }));
    expect(screen.getByAltText('Preview')).toBeInTheDocument();

    fillRequiredFields();
    fireEvent.submit(screen.getByRole('button', { name: /list product/i }).closest('form'));
    await waitFor(() => expect(api.uploadProductImage).toHaveBeenCalledWith(expect.any(File)));
    await waitFor(() => expect(api.createProduct).toHaveBeenCalled());
    expect(api.createProduct.mock.calls[0][0]).toMatchObject({
      name: 'Fresh Tomatoes', price: 12.5, quantity: 8, image_url: '/uploads/product.jpg',
    });
  });
});