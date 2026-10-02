import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Promise-based replacement for window.confirm().
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: 'Delete coupon?', destructive: true }))) return;
 *   ...
 *   return <>{...}{confirmDialog}</>;
 *
 * `confirm` accepts either an options object (see ConfirmDialog props) or a
 * plain string used as the title. It resolves `true` when confirmed and
 * `false` when cancelled (button, Escape, backdrop or unmount).
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const requestRef = useRef(null);

  const settle = useCallback((result) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(result);
  }, []);

  const confirm = useCallback((options) => {
    // A new request supersedes any pending one.
    requestRef.current?.resolve(false);
    const opts = typeof options === 'string' ? { title: options } : { ...options };
    return new Promise((resolve) => {
      requestRef.current = { opts, resolve };
      setRequest(requestRef.current);
    });
  }, []);

  // Never leave a caller awaiting forever if the component unmounts.
  useEffect(() => () => requestRef.current?.resolve(false), []);

  const confirmDialog = request ? (
    <ConfirmDialog
      {...request.opts}
      open
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}

export default useConfirm;
