/**
 * ProductFormCropSrcLeak.test.jsx
 *
 * Verifies that ProductForm revokes every object URL it creates for the crop
 * modal (cropSrc) as soon as that URL is no longer needed:
 *
 *   • on crop confirm  – URL revoked when the farmer accepts the crop
 *   • on crop cancel   – URL revoked when the farmer discards the crop
 *   • on image replace – picking a new image revokes the old cropSrc before
 *                        creating a fresh one
 *   • sequence         – picking N images in sequence revokes N–1 old URLs
 *
 * Strategy for the "confirm" path:
 *   ImageCropModal.handleConfirm calls canvas.toBlob which is a no-op in
 *   jsdom.  Rather than fight that, we mock ImageCropModal so that it
 *   immediately surfaces the onConfirm and onCancel callbacks to our test,
 *   letting us invoke them directly without rendering a canvas at all.  This
 *   is the right boundary to test: ProductForm's contract with its own
 *   callbacks, not ImageCropModal's internals.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ImageCropModal — expose onConfirm / onCancel as buttons so tests can
// trigger them without needing a working canvas.
// ---------------------------------------------------------------------------

let capturedOnConfirm = null;
let capturedOnCancel = null;

vi.mock('../components/ImageCropModal', () => ({
  default: ({ src, onConfirm, onCancel }) => {
    capturedOnConfirm = onConfirm;
    capturedOnCancel = onCancel;
    return (
      <div role="dialog" aria-label="Crop Image" data-testid="mock-crop-modal">
        <span data-testid="modal-src">{src}</span>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => onConfirm(new Blob(['img'], { type: 'image/jpeg' }))}>
          Use Crop
        </button>
      </div>
    );
  },
}));

// ---------------------------------------------------------------------------
// Other mocks
// ---------------------------------------------------------------------------

vi.mock('../api/client', () => ({
  api: {
    getProducts: vi.fn().mockResolvedValue({ data: [] }),
    createProduct: vi.fn().mockResolvedValue({}),
    uploadImage: vi.fn().mockResolvedValue({ imageUrl: 'https://example.com/img.jpg' }),
    createHarvestBatch: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../utils/useXlmRate', () => ({
  useXlmRate: () => ({ usd: () => null }),
}));

// ---------------------------------------------------------------------------
// URL stubs
// ---------------------------------------------------------------------------

let urlCounter = 0;
const revokeObjectURL = vi.fn();
const createObjectURL = vi.fn(() => `blob:mock-url-${++urlCounter}`);

beforeEach(() => {
  urlCounter = 0;
  capturedOnConfirm = null;
  capturedOnCancel = null;
  vi.clearAllMocks();
  Object.defineProperty(globalThis, 'URL', {
    value: { createObjectURL, revokeObjectURL },
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Import component under test *after* mocks are set up
// ---------------------------------------------------------------------------

// Dynamic import is not needed here — Vitest hoists vi.mock calls before
// the module is evaluated, so the static import below already sees the mock.
import ProductForm from '../components/dashboard/ProductForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'photo.jpg', type = 'image/jpeg') {
  return new File(['image-data'], name, { type });
}

function setup() {
  render(<ProductForm harvestBatches={[]} onProductAdded={vi.fn()} />);
  const fileInput = document.querySelector('input[type="file"]');
  expect(fileInput).not.toBeNull();

  function pickFile(file) {
    fireEvent.change(fileInput, { target: { files: [file] } });
  }
  return { fileInput, pickFile };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductForm — cropSrc object URL lifecycle (memory-leak fix)', () => {
  // ── Cancel path ───────────────────────────────────────────────────────────

  it('revokes the cropSrc URL when the farmer cancels the crop', async () => {
    const { pickFile } = setup();

    act(() => pickFile(makeFile('tomato.jpg')));

    // Modal rendered with the correct blob URL
    expect(screen.getByTestId('mock-crop-modal')).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const cropUrl = createObjectURL.mock.results[0].value;
    expect(screen.getByTestId('modal-src')).toHaveTextContent(cropUrl);

    // Cancel
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(cropUrl));
    expect(screen.queryByTestId('mock-crop-modal')).not.toBeInTheDocument();
  });

  // ── Confirm path ─────────────────────────────────────────────────────────

  it('revokes the cropSrc URL when the farmer confirms the crop', async () => {
    const { pickFile } = setup();

    act(() => pickFile(makeFile('carrot.jpg')));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const cropUrl = createObjectURL.mock.results[0].value;

    // Confirm (mock modal calls onConfirm(blob) immediately)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Use Crop' })));

    // cropSrc URL must be revoked
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(cropUrl));
    // Modal gone
    expect(screen.queryByTestId('mock-crop-modal')).not.toBeInTheDocument();
  });

  it('creates a new previewUrl (for the cropped image) but does NOT revoke it immediately', async () => {
    const { pickFile } = setup();

    act(() => pickFile(makeFile('pepper.jpg')));

    // Two createObjectURL calls will happen:
    //  1. cropSrc  – for the modal preview
    //  2. previewUrl – for the confirmed crop shown in the form
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Use Crop' })));

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1));

    // Only cropUrl (call #1) is revoked; previewUrl (call #2) stays alive
    // because it is still displayed in the form.
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    const previewUrl = createObjectURL.mock.results[1].value;
    expect(revokeObjectURL).not.toHaveBeenCalledWith(previewUrl);
  });

  // ── Replace path ─────────────────────────────────────────────────────────

  it('revokes the old cropSrc when the farmer picks a replacement image (replace scenario)', async () => {
    const { pickFile } = setup();

    // Pick first image
    act(() => pickFile(makeFile('first.jpg')));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const firstUrl = createObjectURL.mock.results[0].value;

    // Cancel, then pick another image
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl));

    // Don't reset the counter so we can compare URLs by value across picks
    vi.clearAllMocks();

    // Pick second image – a new (different) URL should be created
    act(() => pickFile(makeFile('second.jpg')));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const secondUrl = createObjectURL.mock.results[0].value;

    // Cancel second image → its URL is revoked
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(secondUrl));
  });

  it('revokes the previous cropSrc when a second image is picked while the modal is still open', async () => {
    // This tests the "replace while modal open" case: farmer picks file A,
    // sees the crop modal, then picks file B without cancelling.
    // The ref-based approach means validateAndSetImage revokes the current
    // cropSrcRef value before setting the new one.
    const { pickFile } = setup();

    // Pick first image — modal opens
    act(() => pickFile(makeFile('alpha.jpg')));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const firstUrl = createObjectURL.mock.results[0].value;

    // Pick second image while modal is still visible (simulates drag-and-drop
    // or file input triggered again e.g. via keyboard)
    act(() => pickFile(makeFile('beta.jpg')));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    const secondUrl = createObjectURL.mock.results[1].value;

    // First URL must have been revoked when the second pick replaced it
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl));
    expect(revokeObjectURL).not.toHaveBeenCalledWith(secondUrl);
  });

  // ── Sequence path ─────────────────────────────────────────────────────────

  it('revokes each cropSrc exactly once across a pick-and-cancel sequence of 4 images', async () => {
    const { pickFile } = setup();
    const pickedUrls = [];

    for (let i = 1; i <= 4; i++) {
      vi.clearAllMocks();
      urlCounter = 0;

      act(() => pickFile(makeFile(`image-${i}.jpg`)));
      const url = createObjectURL.mock.results[0].value;
      pickedUrls.push(url);

      act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(url));
      // Exactly one revoke per cycle — no double-revoke, no missed revoke
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    }
  });

  // ── Guard: no pick yet ────────────────────────────────────────────────────

  it('does not call revokeObjectURL when no image has been picked yet', () => {
    render(<ProductForm harvestBatches={[]} onProductAdded={vi.fn()} />);
    // No file picked, no modal, nothing to revoke
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
