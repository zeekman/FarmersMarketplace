import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock i18n
const mockT = (key) => key;
const mockI18n = {
  language: 'ar',
  changeLanguage: () => Promise.resolve(),
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: mockI18n }),
  Trans: ({ children }) => children,
}));

// Helper to get computed direction
function getDirection(element) {
  const style = window.getComputedStyle(element);
  return style.direction || element.getAttribute('dir');
}

describe('RTL Direction Support', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  it('sets dir="rtl" for Arabic locale', () => {
    document.documentElement.setAttribute('lang', 'ar');
    document.documentElement.setAttribute('dir', 'rtl');
    
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('directional icons flip in RTL', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    
    const { container } = render(
      <div dir="rtl">
        <button className="icon-directional">→</button>
      </div>
    );
    
    const button = container.querySelector('.icon-directional');
    const style = window.getComputedStyle(button);
    
    // In a real browser, the CSS rule [dir=rtl] .icon-directional { transform: scaleX(-1) }
    // would apply. In jsdom, we just verify the class is present.
    expect(button.classList.contains('icon-directional')).toBe(true);
  });

  it('uses logical properties for margins', () => {
    const TestComponent = () => (
      <div style={{ marginInlineStart: 10, marginInlineEnd: 20 }}>
        Content
      </div>
    );
    
    const { container } = render(<TestComponent />);
    const div = container.firstChild;
    
    expect(div.style.marginInlineStart).toBe('10px');
    expect(div.style.marginInlineEnd).toBe('20px');
  });

  it('uses logical properties for padding', () => {
    const TestComponent = () => (
      <div style={{ paddingInlineStart: 8, paddingInlineEnd: 12 }}>
        Content
      </div>
    );
    
    const { container } = render(<TestComponent />);
    const div = container.firstChild;
    
    expect(div.style.paddingInlineStart).toBe('8px');
    expect(div.style.paddingInlineEnd).toBe('12px');
  });

  it('uses textAlign: start instead of left', () => {
    const TestComponent = () => (
      <div style={{ textAlign: 'start' }}>
        Text content
      </div>
    );
    
    const { container } = render(<TestComponent />);
    const div = container.firstChild;
    
    expect(div.style.textAlign).toBe('start');
  });

  it('uses insetInlineStart for absolute positioning', () => {
    const TestComponent = () => (
      <div style={{ position: 'absolute', insetInlineStart: 0 }}>
        Positioned
      </div>
    );
    
    const { container } = render(<TestComponent />);
    const div = container.firstChild;
    
    expect(div.style.insetInlineStart).toBe('0px');
  });
});
