import React from 'react';
import { useTranslation } from 'react-i18next';
import { validatePassword } from '../utils/validation';

const s = {
  strengthHint: { fontSize: 11, color: '#595959', marginTop: 3 },
};

/**
 * Shared password strength indicator used across login, registration,
 * password reset, and settings pages.
 * 
 * Strength rules come from utils/validation.js (validatePassword),
 * matching the backend enforcement rules.
 */
export function PasswordStrength({ password }) {
  const { t } = useTranslation();
  
  if (!password) return null;
  
  const issues = validatePassword(password);
  const score = Math.max(0, 4 - issues.length); // 0–4
  
  // Theme-aware colors (WCAG AA contrast in light and dark themes)
  const colors = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2d6a4f'];
  const labelKeys = [
    'auth.passwordStrength.veryWeak',
    'auth.passwordStrength.weak',
    'auth.passwordStrength.fair',
    'auth.passwordStrength.good',
    'auth.passwordStrength.strong',
  ];
  
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i < score ? colors[score] : '#e0e0e0',
            }}
          />
        ))}
      </div>
      <div style={{ ...s.strengthHint, color: colors[score] }}>
        {t(labelKeys[score])}
      </div>
      {issues.length > 0 && (
        <div style={s.strengthHint}>
          {t('auth.passwordStrength.needs', { issues: issues.join(', ') })}
        </div>
      )}
    </div>
  );
}
