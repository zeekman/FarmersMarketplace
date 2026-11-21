import React from 'react';

const ESCROW_OPTIONS = [
  { value: 'funded', label: 'In escrow' },
  { value: 'released', label: 'Released' },
  { value: 'refunded', label: 'Refunded' },
];

const DISPUTE_OPTIONS = [
  { value: 'open', label: 'Disputed' },
  { value: 'resolved', label: 'Dispute resolved' },
];

function toggleValue(list, value) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/**
 * Filter chips for the Orders page.
 *
 * Controlled component: the parent owns the filter state (typically synced to
 * the URL query string) and receives the next state via `onChange`.
 *
 * @param {object} props
 * @param {string[]} [props.escrow] active escrow statuses (funded|released|refunded)
 * @param {string[]} [props.dispute] active dispute states (open|resolved)
 * @param {boolean} [props.refundable] only orders whose timeout_unix has passed
 * @param {(next: {escrow: string[], dispute: string[], refundable: boolean}) => void} props.onChange
 * @param {() => void} [props.onReset]
 */
export default function OrderFilters({
  escrow = [],
  dispute = [],
  refundable = false,
  onChange,
  onReset,
}) {
  const emit = (patch) => {
    if (typeof onChange !== 'function') return;
    onChange({ escrow, dispute, refundable, ...patch });
  };

  const hasActiveFilters =
    escrow.length > 0 || dispute.length > 0 || refundable;

  return (
    <div className="orders-filters" role="group" aria-label="Order filters">
      <div className="orders-filters__group" aria-label="Escrow status">
        <span className="orders-filters__label">Escrow</span>
        {ESCROW_OPTIONS.map((option) => {
          const active = escrow.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`orders-filters__chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => emit({ escrow: toggleValue(escrow, option.value) })}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="orders-filters__group" aria-label="Dispute state">
        <span className="orders-filters__label">Dispute</span>
        {DISPUTE_OPTIONS.map((option) => {
          const active = dispute.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`orders-filters__chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => emit({ dispute: toggleValue(dispute, option.value) })}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="orders-filters__group">
        <button
          type="button"
          className={`orders-filters__chip${refundable ? ' is-active' : ''}`}
          aria-pressed={refundable}
          onClick={() => emit({ refundable: !refundable })}
        >
          Refundable now
        </button>
      </div>

      {hasActiveFilters && typeof onReset === 'function' && (
        <button
          type="button"
          className="orders-filters__reset"
          onClick={onReset}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
