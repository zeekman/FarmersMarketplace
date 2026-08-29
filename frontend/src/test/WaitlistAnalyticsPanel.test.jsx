import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import WaitlistAnalyticsPanel from '../../components/dashboard/WaitlistAnalyticsPanel';

const BASE_ROWS = [
  {
    product_id: 1,
    product_name: 'Heirloom Tomatoes',
    queue_length: 4,
    avg_wait_hours: 2.5,
    conversion_rate: 75,
    alert: false,
  },
  {
    product_id: 2,
    product_name: 'Raw Honey',
    queue_length: 12,
    avg_wait_hours: 6,
    conversion_rate: null,
    alert: true,
  },
];

// ── Empty state ───────────────────────────────────────────────────────────────

describe('WaitlistAnalyticsPanel — empty state', () => {
  it('renders nothing when rows is empty', () => {
    const { container } = render(<WaitlistAnalyticsPanel rows={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── Table rendering ───────────────────────────────────────────────────────────

describe('WaitlistAnalyticsPanel — table rendering', () => {
  it('renders a row for each product', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText('Heirloom Tomatoes')).toBeInTheDocument();
    expect(screen.getByText('Raw Honey')).toBeInTheDocument();
  });

  it('renders queue_length for each row', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders avg_wait_hours when present', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('renders a dash when avg_wait_hours is null', () => {
    const rows = [{ ...BASE_ROWS[0], avg_wait_hours: null }];
    render(<WaitlistAnalyticsPanel rows={rows} />);
    // The dash cell should appear
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders conversion_rate as a percentage when present', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders a dash for conversion_rate when it is null', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    // BASE_ROWS[1] has conversion_rate: null
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

// ── Alert banner ──────────────────────────────────────────────────────────────

describe('WaitlistAnalyticsPanel — alert banner', () => {
  it('shows the restock alert banner when any row has alert: true', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText(/more than 10 buyers waiting/i)).toBeInTheDocument();
  });

  it('does not show the restock alert banner when no rows have alert: true', () => {
    const rows = BASE_ROWS.map((r) => ({ ...r, alert: false }));
    render(<WaitlistAnalyticsPanel rows={rows} />);
    expect(screen.queryByText(/more than 10 buyers waiting/i)).not.toBeInTheDocument();
  });

  it('shows the "High demand" badge on alerted rows', () => {
    render(<WaitlistAnalyticsPanel rows={BASE_ROWS} />);
    expect(screen.getByText(/high demand/i)).toBeInTheDocument();
  });

  it('does not show a "High demand" badge on non-alerted rows', () => {
    const rows = [BASE_ROWS[0]]; // alert: false
    render(<WaitlistAnalyticsPanel rows={rows} />);
    expect(screen.queryByText(/high demand/i)).not.toBeInTheDocument();
  });
});
