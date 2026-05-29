# Error Boundary - Testing Guide

## Manual Testing Steps

### Test 1: Trigger an Error via Browser Console

1. **Start the development server**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open the app and navigate to any page**
   - App should load normally

3. **Open browser DevTools** (F12)
   - Go to Console tab

4. **Throw an error to test the boundary**
   ```javascript
   throw new Error('Test error from console');
   ```

5. **Expected Behavior:**
   - ✅ Error boundary catches the error
   - ✅ Fallback UI appears with friendly message
   - ✅ "Oops! Something Went Wrong" shown
   - ✅ Error details visible in console
   - ✅ "Error Details (Development Only)" section appears (in dev mode)
   - ✅ "🔄 Reload Page" button is visible

6. **Click "Reload Page" button**
   - ✅ Page reloads
   - ✅ App returns to normal state
   - ✅ Error is gone

---

### Test 2: Test in Development Mode

**With development error details:**

1. **Error boundary should show expanded details section**
   - Click "Error Details (Development Only)" to expand
   - Shows JSON with: message, stack, componentStack, timestamp
   - Helps with debugging

2. **Console should show:**
   ```
   Error caught by ErrorBoundary: Error: Test error
   Error Info: { componentStack: "..." }
   ```

---

### Test 3: Simulate Production Mode

1. **Build the app for production**
   ```bash
   cd frontend
   npm run build
   ```

2. **Serve from production build**
   ```bash
   npm run preview
   ```

3. **Trigger error again from console**
   ```javascript
   throw new Error('Test in production');
   ```

4. **Expected Behavior:**
   - ✅ Fallback UI appears (same as before)
   - ✅ "Error Details" section is NOT visible
   - ✅ Only user-friendly message shown
   - ✅ Error still logged to console
   - ✅ Reload button still works

---

### Test 4: Error in Specific Component

Create a temporary component that throws an error:

1. **Create test component** (in `frontend/src/pages/`)
   ```javascript
   // ErrorTest.jsx
   export default function ErrorTest() {
     throw new Error('Component initialization failed');
     return <div>This won't render</div>;
   }
   ```

2. **Add route to App.jsx temporarily**
   ```javascript
   <Route path="/error-test" element={<ErrorTest />} />
   ```

3. **Navigate to `/error-test`**
   - ✅ Error boundary catches it
   - ✅ Shows friendly error message
   - ✅ Shows which component failed in details

4. **Remove test component and route**

---

### Test 5: Error in Event Handler (Should NOT be caught)

1. **Create component with event handler error**
   ```javascript
   function TestEventError() {
     const handleClick = () => {
       throw new Error('Event handler error');
     };
     return <button onClick={handleClick}>Throw Error</button>;
   }
   ```

2. **Click the button**
   - ❌ Error boundary does NOT catch this
   - ✅ Error appears in console only
   - ✅ App continues working
   - ✅ UI not affected

3. **This is expected behavior** - use try-catch inside event handlers

---

### Test 6: Error from API Call

**Note:** API call errors in componentDidCatch won't be caught by the boundary, but this is expected.

1. **Component with async API call**
   ```javascript
   useEffect(() => {
     fetch('/api/invalid')
       .then(r => r.json())
       .catch(e => {
         // Handle error here
         console.error('API error:', e);
       });
   }, []);
   ```

2. **This error won't trigger boundary** - expected
3. **Use try-catch or .catch() to handle** - recommended pattern

---

### Test 7: Backend Error Logging

**Optional - requires backend endpoint**

1. **Check if `/api/errors` endpoint exists**

2. **If it exists, trigger an error**
   - Check Network tab in DevTools
   - Should see POST request to `/api/errors`
   - Request body includes stack trace and context

3. **If endpoint doesn't exist**
   - Error is logged to console (fallback already there)
   - App still functions normally

---

## Automated Testing (Jest)

### Test Error Boundary Catches Errors

```javascript
// ErrorBoundary.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Component that throws an error
function ThrowError() {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  // Suppress console errors in tests
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  test('displays error UI when child component throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Oops! Something Went Wrong/)).toBeInTheDocument();
    expect(screen.getByText(/unexpected error/)).toBeInTheDocument();
  });

  test('includes reload button', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByText(/Reload Page/);
    expect(reloadButton).toBeInTheDocument();
  });

  test('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Success content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Success content')).toBeInTheDocument();
  });
});
```

---

## Acceptance Criteria Verification

### ✅ Criteria 1: Friendly message instead of blank screen
- [ ] Navigate to `/error-test` page (with test component)
- [ ] Verify error boundary UI appears
- [ ] Verify message says "Oops! Something Went Wrong"
- [ ] Verify app is not blank (has styled error box)

### ✅ Criteria 2: Reload button
- [ ] Error UI is displayed
- [ ] Click "🔄 Reload Page" button
- [ ] Page reloads successfully
- [ ] App returns to normal

### ✅ Criteria 3: Console logging
- [ ] Trigger error from console
- [ ] Open DevTools Console tab
- [ ] Verify "Error caught by ErrorBoundary:" message
- [ ] Verify error stack trace visible

### ✅ Criteria 4: Event handlers not caught
- [ ] Create button with throwing event handler
- [ ] Click button
- [ ] Error appears ONLY in console
- [ ] Error boundary UI does NOT appear
- [ ] App continues to work

### ✅ Criteria 5: Recovers after reload
- [ ] Error boundary active (showing error UI)
- [ ] Click reload button
- [ ] Page reloads
- [ ] App loads normally (hasError state reset)
- [ ] Can navigate and use app again

---

## Troubleshooting

### Issue: Reload button doesn't reload
**Solution:** 
- Check browser console for errors
- Verify JavaScript is enabled
- Try F5 or Cmd+R manually

### Issue: Error details section not showing
**Solution:**
- Check if running in development mode
- Build might be minified in production
- Expected behavior in production

### Issue: Error not caught by boundary
**Solution:**
- Boundary only catches render errors
- Check if error is in event handler
- Use try-catch in event handlers
- Check if error is async (promises, setTimeout)

### Issue: App still shows blank screen
**Solution:**
- Error might be in ErrorBoundary itself
- Check browser console for boundary errors
- Boundary has no error handler (can't catch its own errors)
- Check if error is in outer provider

---

## Performance Considerations

- **Error boundary has minimal performance impact**
- **No error = no overhead** (just wraps children)
- **Error caught = minimal processing** (render fallback UI)
- **Backend logging is non-blocking** (doesn't wait for response)

---

## Notes for Developers

1. **Error boundaries are not a replacement for error handling**
   - Still use try-catch in async code
   - Still use error handlers in event listeners
   - Boundary is a safety net

2. **Multiple boundaries are possible**
   - Can wrap subtrees with their own boundaries
   - Isolates errors to specific sections
   - More granular error handling

3. **State not recovered**
   - After reload, component state is reset
   - App state should be in localStorage/Redux
   - Consider state persistence strategy

4. **Testing in React StrictMode**
   - StrictMode intentionally double-invokes functions
   - May trigger error boundary in development
   - Doesn't happen in production

---

## Cleanup

After testing, remove any test components or routes added:

```bash
# Remove test files
rm frontend/src/pages/ErrorTest.jsx

# Remove test routes from App.jsx
# (Already removed in production code)
```

