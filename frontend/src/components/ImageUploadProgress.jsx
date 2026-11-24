import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadWithProgress } from '../utils/uploadWithProgress';

/**
 * Uploads a cropped/compressed blob with a progress bar, cancel and retry (FE-23).
 */
export default function ImageUploadProgress({ blob, onUploaded, onCancel }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const blobRef = useRef(null);

  // Once unmounted (image removed), a late response must not set the parent's URL.
  React.useEffect(() => () => { blobRef.current = null; }, []);

  const start = useCallback(() => {
    blobRef.current = blob;
    setStatus('uploading');
    setError(null);
    setProgress(0);
    const { promise, abort } = uploadWithProgress(blob, { onProgress: setProgress });
    abortRef.current = abort;
    promise
      .then((data) => { if (blobRef.current !== blob) return; setStatus('done'); onUploaded?.(data); })
      .catch((e) => {
        if (e.cancelled) { setStatus('idle'); onCancel?.(); return; }
        setStatus('error');
        setError(e.message);
      });
  }, [blob, onUploaded, onCancel]);

  React.useEffect(() => { if (blob) start(); }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!blob) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t('upload.progress')}
        style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: '#2d6a4f', transition: 'width 0.2s' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 13 }}>
        {status === 'uploading' && <><span>{progress}%</span><button type="button" onClick={() => abortRef.current?.()}>{t('upload.cancel')}</button></>}
        {status === 'error' && <><span role="alert" style={{ color: '#dc2626' }}>{error}</span><button type="button" onClick={start}>{t('upload.retry')}</button></>}
        {status === 'done' && <span>{t('upload.done')}</span>}
      </div>
    </div>
  );
}
