import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal unit tests for AddressBook default-address logic
// (optimistic update and set-default flow)

const buildAddresses = () => [
  { id: 1, label: 'Home', street: '1 Main St', city: 'Nairobi', country: 'Kenya', postal_code: '', is_default: 1 },
  { id: 2, label: 'Work', street: '2 Work Ave', city: 'Nairobi', country: 'Kenya', postal_code: '', is_default: 0 },
];

// Replicate the optimistic update logic from AddressBook.handleSetDefault
function optimisticSetDefault(addresses, id) {
  return addresses.map(a => ({ ...a, is_default: a.id === id ? 1 : 0 }));
}

describe('AddressBook default address logic', () => {
  it('only one address is default after optimistic update', () => {
    const addresses = buildAddresses();
    const updated = optimisticSetDefault(addresses, 2);
    const defaults = updated.filter(a => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(2);
  });

  it('old default loses chip after setting new default', () => {
    const addresses = buildAddresses();
    const updated = optimisticSetDefault(addresses, 2);
    expect(updated.find(a => a.id === 1).is_default).toBe(0);
    expect(updated.find(a => a.id === 2).is_default).toBe(1);
  });

  it('setting the already-default address keeps it default', () => {
    const addresses = buildAddresses();
    const updated = optimisticSetDefault(addresses, 1);
    expect(updated.find(a => a.id === 1).is_default).toBe(1);
    expect(updated.find(a => a.id === 2).is_default).toBe(0);
  });
});
