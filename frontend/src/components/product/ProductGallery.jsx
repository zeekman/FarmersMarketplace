import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildSrcSet } from '../../utils/imageUtils';

const s = {
  galleryMain: {
    width: '100%',
    maxHeight: 320,
    objectFit: 'cover',
    borderRadius: 10,
    marginBottom: 10,
    display: 'block',
    transition: 'transform 0.3s ease',
  },
  galleryMainContainer: {
    overflow: 'hidden',
    borderRadius: 10,
    marginBottom: 10,
    cursor: 'zoom-in',
  },
  thumbRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
    overflowX: 'auto',
  },
  thumb: {
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 6,
    cursor: 'pointer',
    border: '2px solid transparent',
    flexShrink: 0,
  },
  thumbActive: {
    border: '2px solid #2d6a4f',
  },
  navBtn: {
    background: 'rgba(0,0,0,0.35)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    width: 32,
    height: 32,
    cursor: 'pointer',
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#ccc',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  dotActive: {
    background: '#2d6a4f',
  },
};

/**
 * Product image gallery with thumbnails, navigation arrows, and keyboard support.
 * Falls back to single image or placeholder emoji if no images.
 */
export default function ProductGallery({ images, productName, productImageUrl }) {
  const { t } = useTranslation();
  const [activeImg, setActiveImg] = useState(0);

  // Clamp activeImg to valid range
  const safeActiveImg = images.length > 0 ? Math.min(activeImg, images.length - 1) : 0;

  if (images.length > 0) {
    return (
      <div
        style={{ marginBottom: 16 }}
        role="region"
        aria-label={t('productDetail.imageGallery', 'Image gallery')}
        tabIndex={0}
        onKeyDown={
          images.length > 1
            ? (e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setActiveImg((i) => (i - 1 + images.length) % images.length);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setActiveImg((i) => (i + 1) % images.length);
                }
              }
            : undefined
        }
      >
        <div style={{ position: 'relative' }}>
          <div
            style={s.galleryMainContainer}
            onMouseEnter={(e) =>
              (e.currentTarget.querySelector('img').style.transform = 'scale(1.35)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.querySelector('img').style.transform = '')
            }
          >
            <img
              src={images[safeActiveImg].url}
              srcSet={buildSrcSet(images[safeActiveImg].url)}
              sizes="(max-width: 640px) 100vw, 640px"
              alt={`${productName} photo ${safeActiveImg + 1}`}
              style={s.galleryMain}
            />
          </div>
          {images.length > 1 && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0 8px',
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            >
              <button
                style={{ ...s.navBtn, pointerEvents: 'all' }}
                onClick={() =>
                  setActiveImg((i) => (i - 1 + images.length) % images.length)
                }
                aria-label={t('productDetail.previousImage')}
                className="icon-directional"
              >
                ‹
              </button>
              <button
                style={{ ...s.navBtn, pointerEvents: 'all' }}
                onClick={() => setActiveImg((i) => (i + 1) % images.length)}
                aria-label={t('productDetail.nextImage')}
                className="icon-directional"
              >
                ›
              </button>
            </div>
          )}
        </div>
        {images.length > 1 && (
          <>
            <div style={s.thumbRow}>
              {images.map((img, i) => (
                <img
                  key={img.id}
                  src={img.url}
                  srcSet={buildSrcSet(img.url)}
                  sizes="(max-width: 600px) 25vw, 80px"
                  alt={t('productDetail.thumbnail', { n: i + 1 })}
                  loading="lazy"
                  style={{
                    ...s.thumb,
                    ...(i === safeActiveImg ? s.thumbActive : {}),
                  }}
                  onClick={() => setActiveImg(i)}
                />
              ))}
            </div>
            <div style={s.dotRow} aria-hidden="true">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  style={{ ...s.dot, ...(i === safeActiveImg ? s.dotActive : {}) }}
                  onClick={() => setActiveImg(i)}
                  tabIndex={-1}
                  aria-label={t('productDetail.thumbnail', { n: i + 1 })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (productImageUrl) {
    return (
      <img
        src={productImageUrl}
        srcSet={buildSrcSet(productImageUrl)}
        sizes="(max-width: 640px) 100vw, 640px"
        alt={productName}
        style={{
          width: '100%',
          maxHeight: 280,
          objectFit: 'cover',
          borderRadius: 10,
          marginBottom: 16,
        }}
      />
    );
  }

  return <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>;
}
