# Requirements Document

## Introduction

This feature integrates the Stellar DEX (Decentralized Exchange) order book into the FarmersMarketplace platform to provide real-time XLM/USDC price discovery. Currently, farmers set product prices in XLM without any market context. By surfacing live bid/ask data from the Stellar DEX, farmers can make informed pricing decisions that reflect current market rates. The integration adds a backend endpoint that fetches and caches order book data, displays the current XLM/USDC mid price in the farmer Dashboard header, and shows a USD equivalent hint in the product creation form.

## Glossary

- **Order_Book_Service**: The backend module responsible for fetching and caching Stellar DEX order book data.
- **Market_API**: The Express route handler at `GET /api/market/xlm-usdc` that exposes order book data to the frontend.
- **Stellar_DEX**: The Stellar Decentralized Exchange, accessed via the Horizon API's `/order_book` endpoint.
- **Horizon_Client**: The `@stellar/stellar-sdk` Horizon server instance used to query the Stellar network.
- **XLM_Rate_Widget**: The UI component in the farmer Dashboard header that displays the current XLM/USDC mid price.
- **Price_Hint**: The inline USD equivalent display shown next to the XLM price field in the product creation form.
- **Mid_Price**: The arithmetic mean of the best bid price and the best ask price from the order book.
- **Cache**: An in-memory store that holds the most recent order book response for up to 60 seconds to avoid excessive Horizon API calls.
- **Bid**: The highest price a buyer is willing to pay for XLM in USDC.
- **Ask**: The lowest price a seller is willing to accept for XLM in USDC.

---

## Requirements

### Requirement 1: Fetch Stellar DEX Order Book

**User Story:** As a backend developer, I want a reusable function that fetches the XLM/USDC order book from the Stellar DEX, so that other parts of the system can access live market data.

#### Acceptance Criteria

1. THE Order_Book_Service SHALL export a `getOrderBook(baseAsset, counterAsset)` function that accepts asset descriptors and returns the raw order book from the Stellar Horizon API.
2. WHEN the Horizon API returns a valid order book response, THE Order_Book_Service SHALL resolve with an object containing `bids`, `asks`, and a computed `midPrice` field.
3. WHEN the Horizon API request fails or times out, THE Order_Book_Service SHALL reject with an error that includes a descriptive message.
4. THE Order_Book_Service SHALL use the existing `Horizon_Client` instance defined in `backend/src/utils/stellar.js` to make all Horizon requests.

---

### Requirement 2: Market API Endpoint

**User Story:** As a frontend developer, I want a `GET /api/market/xlm-usdc` endpoint, so that the UI can retrieve current order book data without directly calling Horizon.

#### Acceptance Criteria

1. WHEN a client sends `GET /api/market/xlm-usdc`, THE Market_API SHALL respond with HTTP 200 and a JSON body containing `bids`, `asks`, and `midPrice`.
2. THE Market_API SHALL limit the `bids` and `asks` arrays to the top 10 entries each to keep the response payload small.
3. WHEN the Stellar DEX data is unavailable, THE Market_API SHALL respond with HTTP 503 and a JSON body containing an `error` field with a descriptive message.
4. THE Market_API SHALL require no authentication, as market data is public information.

---

### Requirement 3: Order Book Caching

**User Story:** As a system operator, I want the order book response cached for 60 seconds, so that repeated frontend requests do not overwhelm the Stellar Horizon API.

#### Acceptance Criteria

1. THE Cache SHALL store the most recent successful order book response with a timestamp.
2. WHEN a request arrives and the cached entry is less than 60 seconds old, THE Market_API SHALL return the cached response without calling the Horizon API.
3. WHEN a request arrives and the cached entry is 60 seconds old or older, THE Order_Book_Service SHALL fetch a fresh order book from the Horizon API and update the Cache.
4. WHEN a fresh fetch fails and a stale cached entry exists, THE Market_API SHALL return the stale cached entry with an HTTP 200 response and include a `stale: true` field in the JSON body.
5. IF no cached entry exists and the Horizon API is unreachable, THEN THE Market_API SHALL respond with HTTP 503.

---

### Requirement 4: XLM/USDC Rate Display in Farmer Dashboard

**User Story:** As a farmer, I want to see the current XLM/USDC mid price in my Dashboard header, so that I understand the market value of XLM before pricing my products.

#### Acceptance Criteria

1. WHEN the farmer Dashboard page loads, THE XLM_Rate_Widget SHALL call `GET /api/market/xlm-usdc` and display the returned `midPrice` formatted as `1 XLM ≈ $<midPrice> USDC`.
2. WHILE the order book data is loading, THE XLM_Rate_Widget SHALL display a loading placeholder so the layout does not shift.
3. IF the `GET /api/market/xlm-usdc` request fails, THEN THE XLM_Rate_Widget SHALL display a non-blocking fallback message (e.g., "Rate unavailable") without disrupting other Dashboard functionality.
4. THE XLM_Rate_Widget SHALL refresh the displayed rate at most once every 60 seconds to align with the server-side cache TTL.

---

### Requirement 5: USD Price Hint in Product Creation Form

**User Story:** As a farmer, I want to see a USD equivalent next to the XLM price I enter in the product creation form, so that I can price my products competitively relative to current market rates.

#### Acceptance Criteria

1. WHEN a farmer enters a numeric value in the Price (XLM) field of the product creation form, THE Price_Hint SHALL compute and display the USD equivalent as `≈ $<amount> USD` below the input field.
2. THE Price_Hint SHALL derive the USD equivalent by multiplying the entered XLM amount by the `midPrice` obtained from `GET /api/market/xlm-usdc`.
3. WHILE the order book data has not yet loaded, THE Price_Hint SHALL not render any hint text so the form remains uncluttered.
4. IF the order book data is unavailable, THEN THE Price_Hint SHALL not render any hint text and SHALL NOT block the farmer from submitting the form.
5. THE Price_Hint SHALL update in real time as the farmer types, with no additional network requests triggered per keystroke.

---

### Requirement 6: Graceful Degradation

**User Story:** As a farmer, I want the marketplace to remain fully functional even when Stellar DEX data is unavailable, so that I can still list and manage products without interruption.

#### Acceptance Criteria

1. IF the Stellar DEX or Horizon API is unreachable, THEN THE Market_API SHALL respond with HTTP 503 and the frontend SHALL continue to operate normally without the rate display.
2. WHEN DEX data is unavailable, THE XLM_Rate_Widget SHALL display "Rate unavailable" and SHALL NOT throw an unhandled error or crash the Dashboard.
3. WHEN DEX data is unavailable, THE Price_Hint SHALL be hidden and the product creation form SHALL remain fully submittable.
4. THE Order_Book_Service SHALL enforce a request timeout of 5 seconds on all Horizon API calls so that a slow Horizon response does not block the Market_API indefinitely.
