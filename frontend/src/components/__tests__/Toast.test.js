import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Toast, { useToast } from '../Toast';

// Mock the document object for style injection
Object.defineProperty(window, 'document', {
  value: {
    getElementById: jest.fn(() => null),
    head: {
      appendChild: jest.fn()
    }
  }
});

// Test component that uses the useToast hook
function TestComponent() {
  const { showSuccess, showError, toasts } = useToast();
  
  return (
    <div>
      <button onClick={() => showSuccess('Success message')}>Show Success</button>
      <button onClick={() => showError('Error message')}>Show Error</button>
      <Toast toasts={toasts} />
    </div>
  );
}

describe('Toast Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders success toast with correct message', async () => {
    render(<TestComponent />);
    
    const successButton = screen.getByText('Show Success');
    fireEvent.click(successButton);
    
    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });
  });

  test('renders error toast with correct message', async () => {
    render(<TestComponent />);
    
    const errorButton = screen.getByText('Show Error');
    fireEvent.click(errorButton);
    
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });
  });

  test('toast has correct accessibility attributes', async () => {
    render(<TestComponent />);
    
    const successButton = screen.getByText('Show Success');
    fireEvent.click(successButton);
    
    await waitFor(() => {
      const toastContainer = screen.getByRole('status');
      expect(toastContainer).toHaveAttribute('aria-live', 'polite');
      expect(toastContainer).toHaveAttribute('aria-atomic', 'true');
    });
  });

  test('multiple toasts can be displayed simultaneously', async () => {
    render(<TestComponent />);
    
    const successButton = screen.getByText('Show Success');
    const errorButton = screen.getByText('Show Error');
    
    fireEvent.click(successButton);
    fireEvent.click(errorButton);
    
    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getAllByRole('status')).toHaveLength(2);
    });
  });

  test('toast auto-removes after duration', async () => {
    jest.useFakeTimers();
    render(<TestComponent />);
    
    const successButton = screen.getByText('Show Success');
    fireEvent.click(successButton);
    
    // Toast should be visible initially
    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
    
    // Fast-forward time
    jest.advanceTimersByTime(3000);
    
    // Toast should be removed after 3 seconds
    await waitFor(() => {
      expect(screen.queryByText('Success')).not.toBeInTheDocument();
    });
    
    jest.useRealTimers();
  });

  test('error toast stays longer than success toast', async () => {
    jest.useFakeTimers();
    render(<TestComponent />);
    
    const errorButton = screen.getByText('Show Error');
    fireEvent.click(errorButton);
    
    // Toast should be visible initially
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
    
    // Fast-forward 3 seconds (success toast duration)
    jest.advanceTimersByTime(3000);
    
    // Error toast should still be visible
    expect(screen.getByText('Error')).toBeInTheDocument();
    
    // Fast-forward 2 more seconds (total 5 seconds)
    jest.advanceTimersByTime(2000);
    
    // Error toast should now be removed
    await waitFor(() => {
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
    });
    
    jest.useRealTimers();
  });
});

describe('useToast Hook', () => {
  test('showSuccess adds success toast', () => {
    let toasts;
    function HookTest() {
      const { showSuccess, toasts: toastList } = useToast();
      toasts = toastList;
      
      React.useEffect(() => {
        showSuccess('Test success');
      }, [showSuccess]);
      
      return null;
    }
    
    render(<HookTest />);
    
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      message: 'Test success',
      type: 'success'
    });
  });

  test('showError adds error toast', () => {
    let toasts;
    function HookTest() {
      const { showError, toasts: toastList } = useToast();
      toasts = toastList;
      
      React.useEffect(() => {
        showError('Test error');
      }, [showError]);
      
      return null;
    }
    
    render(<HookTest />);
    
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      message: 'Test error',
      type: 'error'
    });
  });

  test('addToast returns toast ID', () => {
    let toastId;
    function HookTest() {
      const { addToast } = useToast();
      
      React.useEffect(() => {
        toastId = addToast('Test message', 'success');
      }, [addToast]);
      
      return null;
    }
    
    render(<HookTest />);
    
    expect(typeof toastId).toBe('number');
    expect(toastId).toBeGreaterThan(0);
  });

  test('removeToast removes specific toast', () => {
    let toasts, removeToast;
    function HookTest() {
      const { addToast, toasts: toastList, removeToast: remove } = useToast();
      toasts = toastList;
      removeToast = remove;
      
      React.useEffect(() => {
        const id1 = addToast('Toast 1', 'success');
        const id2 = addToast('Toast 2', 'success');
        
        // Remove the first toast
        setTimeout(() => remove(id1), 100);
      }, [addToast, remove]);
      
      return null;
    }
    
    render(<HookTest />);
    
    // Should have 2 toasts initially
    expect(toasts).toHaveLength(2);
    
    // After removal, should have 1 toast
    setTimeout(() => {
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe('Toast 2');
    }, 150);
  });
});
