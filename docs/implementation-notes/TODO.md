# TODO: Personalized Recommendations (feat/recommendations)

- [x] 1. Created branch feat/recommendations ✅
- [x] 2. Created migration 003_product_views.sql ✅
- [x] 3. Ran migration ✅
- [x] 4. Updated backend/src/routes/products.js (add view tracking) ✅
- [x] 5. Created backend/src/routes/recommendations.js (new endpoint) ✅
- [x] 6. Updated backend/src/routes/index.js (mount route) ✅
- [x] 7. Updated frontend/src/api/client.js (add getRecommendations) ✅
- [x] 8. Updated frontend/src/pages/Marketplace.jsx (UI section) ✅
- [x] 9. Tested endpoints ✅
- [x] 10. Committed changes ✅
# SEP-0007 Payment Links Progress

## Plan Steps:
- [x] 1. Create Git branch `feat/sep0007-payment-links`
- [ ] 2. Add `generatePaymentLink()` to `backend/src/utils/stellar.js`
- [ ] 3. Add GET `/api/orders/:id/payment-link` route in `backend/src/routes/orders.js`
- [ ] 4. Add `getOrderPaymentLink(id)` to `frontend/src/api/client.js`
- [ ] 5. Update `frontend/src/pages/ProductDetail.jsx` with payment link UI + QR modal
- [ ] 6. Install `qrcode.react` in frontend
- [ ] 7. Add tests
- [ ] 8. Test end-to-end
- [ ] 9. Commit & PR
