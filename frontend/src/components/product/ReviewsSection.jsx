import React from 'react';
import { useTranslation } from 'react-i18next';
import StarRating from '../StarRating';

const s = {
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#2d6a4f',
    marginBottom: 16,
  },
  reviewCard: {
    borderBottom: '1px solid #f0f0f0',
    paddingBottom: 14,
    marginBottom: 14,
  },
  reviewName: {
    fontWeight: 600,
    fontSize: 14,
    color: '#333',
  },
  reviewDate: {
    fontSize: 12,
    color: '#aaa',
    marginInlineStart: 8,
  },
  reviewText: {
    fontSize: 14,
    color: '#555',
    marginTop: 6,
    lineHeight: 1.5,
  },
  empty: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    padding: '24px 0',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: 14,
    resize: 'vertical',
    minHeight: 80,
    boxSizing: 'border-box',
  },
  label: {
    fontSize: 13,
    color: '#555',
    marginBottom: 6,
    display: 'block',
  },
  btn: {
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 28px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 16,
    minHeight: 44,
  },
  err: {
    color: '#c0392b',
    fontSize: 14,
    marginTop: 8,
  },
};

/**
 * Reviews list and review submission form.
 * Shows existing reviews and allows buyers who purchased the product to submit a review.
 */
export default function ReviewsSection({ reviews, review, paidOrders }) {
  const { t } = useTranslation();

  return (
    <>
      {/* Reviews list */}
      <div style={s.sectionTitle}>{t('productDetail.reviews')}</div>
      {reviews.length > 0 ? (
        reviews.map((r) => (
          <div key={r.id} style={s.reviewCard}>
            <div>
              <span style={s.reviewName}>{r.buyer_name || 'Anonymous'}</span>
              <span style={s.reviewDate}>
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>
            <StarRating value={r.rating} size={14} />
            <div style={s.reviewText}>{r.comment}</div>
          </div>
        ))
      ) : (
        <div style={s.empty}>{t('productDetail.noReviews')}</div>
      )}

      {/* Review form (only for buyers who purchased) */}
      {paidOrders.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={s.sectionTitle}>{t('productDetail.writeReview')}</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              review.handleReviewSubmit();
            }}
          >
            <label style={s.label} htmlFor="review-rating">
              {t('productDetail.rating')}
            </label>
            <StarRating
              value={review.rating}
              onChange={(val) => review.setRating(val)}
              interactive
              size={24}
            />
            <label style={{ ...s.label, marginTop: 12 }} htmlFor="review-comment">
              {t('productDetail.comment')}
            </label>
            <textarea
              id="review-comment"
              style={s.textarea}
              value={review.comment}
              onChange={(e) => review.setComment(e.target.value)}
              placeholder={t('productDetail.commentPlaceholder')}
            />
            {review.error && <div style={s.err}>{review.error}</div>}
            <button
              type="submit"
              style={{ ...s.btn, marginTop: 12 }}
              disabled={review.submitting}
            >
              {review.submitting
                ? t('productDetail.submittingReview')
                : t('productDetail.submitReview')}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
