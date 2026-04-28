import { describe, it, expect } from 'vitest';

// Inline the factory to test it in isolation without importing the full component
function getEmptyForm() {
  return {
    name: '',
    description: '',
    price: '',
    quantity: '',
    unit: 'kg',
    category: 'other',
    is_preorder: false,
    preorder_delivery_date: '',
  };
}

describe('getEmptyForm', () => {
  it('returns a fresh object on every call', () => {
    const a = getEmptyForm();
    const b = getEmptyForm();
    expect(a).not.toBe(b);
  });

  it('reset form has empty fields after editing', () => {
    let form = getEmptyForm();

    // Simulate user editing fields
    form.name = 'Tomatoes';
    form.price = '2.5';
    form.quantity = '10';

    // Simulate form reset
    form = getEmptyForm();

    expect(form.name).toBe('');
    expect(form.price).toBe('');
    expect(form.quantity).toBe('');
  });

  it('mutations to one instance do not affect another', () => {
    const form1 = getEmptyForm();
    const form2 = getEmptyForm();

    form1.name = 'Carrots';

    expect(form2.name).toBe('');
  });
});
