# feat/add-idempotency-orders

## Steps:
- [x] 1. Checkout new branch feat/add-idempotency-orders&#10;

- [x] 2. Update schema.js: Add idempotency table

- [x] 3. Update orders.js: Add idempotency key header check, cache lookup/store response
- [x] 4. Update orders.test.js: Add tests for first request caches, second returns cached

- [x] 5. npm test in backend/

- [ ] 6. Commit
- [ ] 7. Push + gh pr create --base main --title "feat: add idempotency cache for /orders"

