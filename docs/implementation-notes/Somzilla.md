Issue:#1033 Pagination.jsx's buildPageList does not clamp the current page to a valid range, rendering an invalid page button when totalPages shrinks

Project
FarmersMarketplace — Frontend (Shared Components)

Description
frontend/src/components/Pagination.jsx's buildPageList(current, total) always includes the caller-supplied current page in its displayed set:

const pages = new Set([1, total, current]);
If a parent component's page prop becomes stale relative to a shrinking totalPages — for example, a user is on page 8 of a filtered product list, then changes a filter that reduces the result set to 3 total pages, and the parent hasn't yet clamped page back into range before re-rendering Pagination — buildPageList will happily include 8 in the rendered button list even though 8 > totalPages. Clicking that button calls onChange(8), requesting a page that doesn't exist.

Acceptance Criteria
 buildPageList (or the component itself) clamps current to [1, total] before building the page-button set.
 A test passes current=8, total=3 and asserts no button for page 8 is rendered, and that a valid page (e.g. page 3) is shown/marked current instead.
 Callers of Pagination are checked to confirm they clamp page in their own state when totalPages changes, as defense in depth.