/**
 * E2E spec: 2FA TOTP setup and verification flow (#1048)
 *
 * Covers:
 *   1. Initial state — Settings page shows the "2FA disabled" warning and an
 *      "Enable 2FA" button.
 *   2. Invalid code during setup — entering 000000 is rejected with a clear
 *      error and the setup wizard stays open.
 *   3. Valid TOTP code enables 2FA — the component flips to the enabled state
 *      and a GET /api/v1/auth/2fa/status call confirms it server-side.
 *   4. 2FA can be disabled — enabling via the API then disabling via the UI
 *      works end-to-end and the API confirms the disabled state.
 *
 * Login-time 2FA gate:
 *   The current backend /api/auth/login endpoint does not yet return a TOTP
 *   challenge (it issues a token regardless of 2FA status).  The login-prompt
 *   test is therefore deferred with a TODO comment for when the gate is wired
 *   up server-side.
 *
 * CSRF:
 *   The CSRF token is served at /api/csrf-token (registered directly in
 *   app.js).  It is NOT under the /api/v1 prefix which only covers business
 *   routes registered through registerRoute().  Every mutating API call made
 *   from the test runner must include this token as the x-csrf-token header.
 *
 * Dependencies:
 *   speakeasy — already in e2e/package.json (same library used by the backend).
 */

import { test, expect, APIRequestContext } from '@playwright/test';
// speakeasy ships CJS; Node / Playwright can require it directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy') as {
  totp: (opts: { secret: string; encoding: string; window?: number }) => string;
};

const ts         = Date.now();
const USER_EMAIL = `twofa_user_${ts}@test.invalid`;
const PASS       = 'TestPass1!';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed the CSRF cookie and return the token for use as the x-csrf-token header.
 * The endpoint lives at /api/csrf-token (app.js) — NOT at /api/v1/csrf-token.
 */
async function getCsrf(req: APIRequestContext): Promise<string> {
  const res  = await req.get('/api/csrf-token');
  const body = await res.json();
  return body.csrfToken as string;
}

async function apiLogin(
  req: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res  = await req.post('/api/v1/auth/login', { data: { email, password } });
  const body = await res.json();
  return body.token as string;
}

/**
 * Idempotently disable 2FA via the API so tests start from a clean state.
 * No-ops when 2FA is already disabled.
 */
async function ensure2FADisabled(
  req: APIRequestContext,
  token: string,
): Promise<void> {
  const statusRes = await req.get('/api/v1/auth/2fa/status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { enabled } = await statusRes.json();
  if (!enabled) return;

  const csrf = await getCsrf(req);
  await req.post('/api/v1/auth/2fa/disable', {
    headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf },
  });
}

// ─── seed ─────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/register');
  await page.fill('#reg-name',     `2FA User ${ts}`);
  await page.fill('#reg-email',    USER_EMAIL);
  await page.fill('#reg-password', PASS);
  await page.selectOption('#reg-role', 'buyer');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/marketplace/, { timeout: 15_000 });

  await ctx.close();
});

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('2FA TOTP setup and verification (#1048)', () => {
  // Each test starts with 2FA disabled and the user logged in via UI.
  test.beforeEach(async ({ page, request }) => {
    const token = await apiLogin(request, USER_EMAIL, PASS);
    await ensure2FADisabled(request, token);

    await page.goto('/login');
    await page.fill('#login-email',    USER_EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/marketplace/, { timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('initial state shows 2FA disabled warning on Settings page', async ({ page }) => {
    await page.goto('/settings');

    // TwoFactorAuth component renders the disabled state as:
    //   <div style={s.warn}>⚠️ 2FA is currently disabled. …</div>
    await expect(
      page.locator('text=⚠️ 2FA is currently disabled').or(
        page.locator('text=2FA is currently disabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // "Enable 2FA" button must be present
    await expect(
      page.locator('button:has-text("Enable 2FA")').first(),
    ).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('entering an invalid 6-digit code during setup shows an error', async ({ page }) => {
    await page.goto('/settings');

    // Start setup — this calls api.setup2FA() which hits POST /api/v1/auth/2fa/setup
    await page.locator('button:has-text("Enable 2FA")').first().click();

    // The QR step is rendered once the setup API call returns; wait for the
    // manual-entry input to appear (placeholder="000000" in TwoFactorAuth.jsx)
    const codeInput = page.locator('input[placeholder="000000"]').first();
    await expect(codeInput).toBeVisible({ timeout: 10_000 });

    // Enter an obviously wrong code
    await codeInput.fill('000000');

    // The "Verify & Enable" button is enabled only when code length === 6
    const verifyBtn = page.locator('button:has-text("Verify & Enable")').first();
    await expect(verifyBtn).toBeEnabled({ timeout: 3_000 });
    await verifyBtn.click();

    // Backend rejects the wrong code with "Invalid verification code"
    await expect(
      page.locator('text=Invalid verification code').or(
        page.locator('text=Verification failed'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Must still be in the setup step (not flipped to enabled)
    await expect(
      page.locator('button:has-text("Verify & Enable")').first(),
    ).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('valid TOTP code enables 2FA and Settings page shows enabled state', async ({
    page,
    request,
  }) => {
    await page.goto('/settings');

    // ── Start setup ──────────────────────────────────────────────────────────
    await page.locator('button:has-text("Enable 2FA")').first().click();

    // The component renders:
    //   "Can't scan? Enter this code manually: <code>{secret}</code>"
    // We read the secret from the <code> element.
    const secretEl = page.locator('code').first();
    await expect(secretEl).toBeVisible({ timeout: 10_000 });
    const secret = ((await secretEl.textContent()) ?? '').trim();
    expect(secret.length).toBeGreaterThan(0);

    // ── Compute valid TOTP ────────────────────────────────────────────────────
    // window:1 tolerates ±30 s of clock skew in CI
    const validCode = speakeasy.totp({ secret, encoding: 'base32', window: 1 });
    expect(validCode).toMatch(/^\d{6}$/);

    // ── Enter the valid code ──────────────────────────────────────────────────
    const codeInput = page.locator('input[placeholder="000000"]').first();
    await codeInput.fill(validCode);

    const verifyBtn = page.locator('button:has-text("Verify & Enable")').first();
    await expect(verifyBtn).toBeEnabled({ timeout: 3_000 });
    await verifyBtn.click();

    // ── Assert success state ──────────────────────────────────────────────────
    // TwoFactorAuth.jsx: setMsg({ type: 'ok', text: '2FA enabled successfully!' })
    await expect(
      page.locator('text=2FA enabled successfully').first(),
    ).toBeVisible({ timeout: 10_000 });

    // The component also renders the enabled banner:
    //   <div>✓ 2FA is enabled on your account.</div>
    await expect(
      page.locator('text=2FA is enabled on your account').or(
        page.locator('text=✓ 2FA is enabled'),
      ).first(),
    ).toBeVisible({ timeout: 5_000 });

    // "Disable 2FA" button replaces "Enable 2FA"
    await expect(
      page.locator('button:has-text("Disable 2FA")').first(),
    ).toBeVisible();
    await expect(page.locator('button:has-text("Enable 2FA")')).toHaveCount(0);

    // ── Verify via API ────────────────────────────────────────────────────────
    const token     = await apiLogin(request, USER_EMAIL, PASS);
    const statusRes = await request.get('/api/v1/auth/2fa/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { enabled } = await statusRes.json();
    // Backend: rows[0]?.enabled === 1  →  boolean true
    expect(enabled).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('2FA can be disabled from Settings after being enabled', async ({ page, request }) => {
    // ── Pre-condition: enable 2FA via the API so this test is independent ─────
    const token = await apiLogin(request, USER_EMAIL, PASS);

    const csrf1    = await getCsrf(request);
    const setupRes = await request.post('/api/v1/auth/2fa/setup', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf1 },
    });
    expect(setupRes.ok(), `2FA setup should succeed (got ${setupRes.status()})`).toBeTruthy();
    const { secret, backupCodes } = await setupRes.json();

    const code   = speakeasy.totp({ secret, encoding: 'base32', window: 1 });
    const csrf2  = await getCsrf(request);
    const verRes = await request.post('/api/v1/auth/2fa/verify', {
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrf2 },
      data: { secret, code, backupCodes },
    });
    expect(verRes.ok(), `2FA verify should succeed (got ${verRes.status()})`).toBeTruthy();

    // ── Navigate to Settings — confirm enabled state ───────────────────────
    await page.goto('/settings');
    await expect(
      page.locator('text=2FA is enabled on your account').or(
        page.locator('text=✓ 2FA is enabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Disable via the UI ─────────────────────────────────────────────────
    // handleDisable() calls window.confirm — accept the dialog automatically
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('button:has-text("Disable 2FA")').first().click();

    // After disabling the component shows: setMsg({ text: '2FA disabled' })
    // and sets enabled=false — which re-renders the disabled-state banner.
    await expect(
      page.locator('text=2FA disabled').or(
        page.locator('text=⚠️ 2FA is currently disabled'),
      ).first(),
    ).toBeVisible({ timeout: 10_000 });

    // "Enable 2FA" must be back
    await expect(
      page.locator('button:has-text("Enable 2FA")').first(),
    ).toBeVisible();

    // ── Confirm via API ────────────────────────────────────────────────────
    const freshToken = await apiLogin(request, USER_EMAIL, PASS);
    const statusRes  = await request.get('/api/v1/auth/2fa/status', {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    const { enabled } = await statusRes.json();
    expect(enabled).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TODO: When /api/auth/login is updated to return { requires2fa: true } and
  // a challenge token when 2FA is enabled, add a test here that:
  //   1. Enables 2FA for the user.
  //   2. Logs out.
  //   3. Submits email + password — expects the login page to show a TOTP field.
  //   4. Submits a valid TOTP code — expects successful redirect.
  //   5. Submits an invalid TOTP code — expects an inline error.
});
