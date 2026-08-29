import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: { reorderProductImages: vi.fn() },
}));

import ImageGalleryManager from '../components/dashboard/ImageGalleryManager';
import { api } from '../api/client';

const GALLERY = ['https://img.test/0.png', 'https://img.test/1.png', 'https://img.test/2.png'];

beforeEach(() => {
  vi.clearAllMocks();
});

function srcs(container) {
  return Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
}

describe('ImageGalleryManager', () => {
  it('deletes the correct image by index', () => {
    const { container } = render(<ImageGalleryManager productId={1} images={GALLERY} />);
    fireEvent.click(screen.getAllByText('✕')[1]);
    expect(srcs(container)).toEqual([GALLERY[0], GALLERY[2]]);
  });

  it('reassigns the cover badge to the new first image when the cover is deleted', () => {
    const { container } = render(<ImageGalleryManager productId={1} images={GALLERY} />);
    fireEvent.click(screen.getAllByText('✕')[0]);
    const firstItem = container.querySelectorAll('[draggable="true"]')[0];
    expect(firstItem.querySelector('img')).toHaveAttribute('src', GALLERY[1]);
    expect(firstItem).toHaveTextContent('Cover');
  });

  it('moves the cover to the new first image after an optimistic reorder', () => {
    const { container } = render(<ImageGalleryManager productId={1} images={GALLERY} />);
    const items = container.querySelectorAll('[draggable="true"]');
    fireEvent.dragStart(items[0]);
    fireEvent.drop(items[2]);
    expect(srcs(container)).toEqual([GALLERY[1], GALLERY[2], GALLERY[0]]);
    const firstItem = container.querySelectorAll('[draggable="true"]')[0];
    expect(firstItem).toHaveTextContent('Cover');
  });

  it('reverts the optimistic order to the saved baseline when saving fails', async () => {
    api.reorderProductImages.mockRejectedValue(new Error('Network down'));
    const { container } = render(<ImageGalleryManager productId={1} images={GALLERY} />);
    const items = container.querySelectorAll('[draggable="true"]');
    fireEvent.dragStart(items[0]);
    fireEvent.drop(items[2]);
    expect(srcs(container)).toEqual([GALLERY[1], GALLERY[2], GALLERY[0]]);
    fireEvent.click(screen.getByRole('button', { name: /save gallery order/i }));
    await screen.findByText(/network down/i);
    expect(srcs(container)).toEqual(GALLERY);
  });

  it('calls api.reorderProductImages with the product id and ordered urls on save', async () => {
    api.reorderProductImages.mockResolvedValue({});
    render(<ImageGalleryManager productId={7} images={GALLERY} />);
    fireEvent.click(screen.getByRole('button', { name: /save gallery order/i }));
    await screen.findByText(/gallery order saved/i);
    expect(api.reorderProductImages).toHaveBeenCalledWith(7, GALLERY);
  });
});
