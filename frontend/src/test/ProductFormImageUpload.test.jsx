import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api/client', () => ({
  api: {
    uploadImage: vi.fn(),
    createProduct: vi.fn(),
  },
}));

vi.mock('../../utils/useXlmRate', () => ({
  useXlmRate: () => ({ usd: () => null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

vi.mock('../components/ImageCropModal', () => ({
  default: ({ onConfirm, onCancel }) => (
    <div>
      <button onClick={() => onConfirm(new Blob(['test'], { type: 'image/jpeg' }))}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import ProductForm from '../components/dashboard/ProductForm';
import { api } from '../../api/client';

describe('ProductForm image upload handling (#1068)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables submit button and shows loading state during slow image upload', async () => {
    const slowUpload = new Promise((resolve) => setTimeout(() => resolve({ imageUrl: 'http://test.com/image.jpg' }), 100));
    api.uploadImage.mockReturnValue(slowUpload);
    api.createProduct.mockResolvedValue({});

    const onProductAdded = vi.fn();
    render(<ProductForm harvestBatches={[]} onProductAdded={onProductAdded} />);

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Test Product' } });
    fireEvent.change(screen.getByLabelText(/Price \(XLM\)/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '5' } });

    // Simulate image file selection
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/Product Image/i).closest('div').querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Click confirm on crop modal
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm'));
    });

    // Submit button should be disabled during upload
    const submitBtn = screen.getByRole('button', { name: /list product/i });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('dashboard.uploading');

    // Wait for upload to complete
    await waitFor(async () => {
      expect(api.uploadImage).toHaveBeenCalled();
    });

    // Submit form
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(api.createProduct).toHaveBeenCalled();
  });

  it('shows specific error message when image upload fails and preserves form state', async () => {
    const uploadError = new Error('Upload failed: network error');
    api.uploadImage.mockRejectedValue(uploadError);
    api.createProduct.mockResolvedValue({});

    const onProductAdded = vi.fn();
    render(<ProductForm harvestBatches={[]} onProductAdded={onProductAdded} />);

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Test Product' } });
    fireEvent.change(screen.getByLabelText(/Price \(XLM\)/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '5' } });

    // Simulate image file selection
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/Product Image/i).closest('div').querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Click confirm on crop modal
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm'));
    });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /list product/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText(/Image upload failed/i)).toBeInTheDocument();
    });

    // Form fields should be preserved
    expect(screen.getByLabelText(/Product Name/i)).toHaveValue('Test Product');
    expect(screen.getByLabelText(/Price \(XLM\)/i)).toHaveValue('10');
    expect(screen.getByLabelText(/Quantity/i)).toHaveValue('5');

    // Product should not be created
    expect(api.createProduct).not.toHaveBeenCalled();
    expect(onProductAdded).not.toHaveBeenCalled();
  });

  it('allows product creation without image when image upload is skipped', async () => {
    api.uploadImage.mockReturnValue({ imageUrl: 'http://test.com/image.jpg' });
    api.createProduct.mockResolvedValue({});

    const onProductAdded = vi.fn();
    render(<ProductForm harvestBatches={[]} onProductAdded={onProductAdded} />);

    // Fill required fields without image
    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Test Product' } });
    fireEvent.change(screen.getByLabelText(/Price \(XLM\)/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '5' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /list product/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(api.createProduct).toHaveBeenCalled();
    expect(onProductAdded).toHaveBeenCalled();
  });
});
