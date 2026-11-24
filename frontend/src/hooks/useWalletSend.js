import { useState } from 'react';
import { api, newIdempotencyKey } from '../api/client';
import { getErrorMessage } from '../utils/errorMessages';
import {
  classifyDestination,
  validateMemo,
  isValidAmount,
  getExchangeName,
  maxSendable,
} from '../utils/stellarAddress';

const EMPTY_FORM = { destination: '', amount: '', memo: '', memoType: 'text', totp: '' };

/** Withdraw XLM to a Stellar public key, muxed address or federation address. Two steps: review, then confirm. */
export function useWalletSend({ availableBalance, onSent, twoFactorEnabled, onTwoFactorRequired }) {
  const [sendForm, setSendForm] = useState(EMPTY_FORM);
  const [sending, setSending]   = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sendMsg, setSendMsg]   = useState(null);
  // { publicKey, federation, exists, memo, memoType, amount, idempotencyKey }
  const [sendReview, setSendReview] = useState(null);

  const sendAmount = parseFloat(sendForm.amount);
  const sendExceedsBalance = sendForm.amount !== '' && !isNaN(sendAmount) && sendAmount > availableBalance;
  const memoError = validateMemo(sendForm.memoType, sendForm.memo);
  const exchangeName = getExchangeName(sendForm.destination);
  const amountDecimalsError = sendForm.amount !== '' && !isValidAmount(sendForm.amount)
    ? 'Enter a positive amount with at most 7 decimal places.'
    : null;

  // Any edit invalidates a pending review so the user always confirms what is on screen.
  function updateSend(patch) {
    setSendForm(f => ({ ...f, ...patch }));
    setSendReview(null);
  }

  function handleMax() {
    updateSend({ amount: String(maxSendable(availableBalance)) });
  }

  function cancelReview() {
    setSendReview(null);
  }

  // Step 1: validate, resolve federation, check the destination, then open the review.
  async function handleReview(e) {
    e.preventDefault();
    setSendMsg(null);
    const destination = sendForm.destination.trim();
    const amount = parseFloat(sendForm.amount);
    if (!destination)
      return setSendMsg({ type: 'err', text: 'Destination address is required.' });
    const kind = classifyDestination(destination);
    if (!kind)
      return setSendMsg({ type: 'err', text: 'Invalid destination. Enter a Stellar public key (G…), muxed address (M…) or federation address (name*domain).' });
    if (!isValidAmount(sendForm.amount))
      return setSendMsg({ type: 'err', text: 'Amount must be greater than 0 with at most 7 decimal places.' });
    if (amount > availableBalance)
      return setSendMsg({ type: 'err', text: `Insufficient balance. You have ${availableBalance.toFixed(7)} XLM available.` });
    if (memoError)
      return setSendMsg({ type: 'err', text: memoError });

    setReviewing(true);
    try {
      let publicKey = destination;
      let memo = sendForm.memo;
      let memoType = sendForm.memoType;
      let federation = null;
      if (kind === 'federation') {
        const res = await api.resolveFederation(destination);
        publicKey = res.publicKey;
        federation = destination;
        // A memo returned by the federation server is required by the recipient.
        if (res.memo && !memo) {
          memo = String(res.memo);
          memoType = /^\d+$/.test(memo) ? 'id' : 'text';
          setSendForm(f => ({ ...f, memo, memoType }));
        }
      }
      const { exists, memoRequired } = await api.checkAccountExists(publicKey);
      if (!exists && publicKey.startsWith('M'))
        return setSendMsg({ type: 'err', text: 'This muxed account does not exist on the network.' });
      if (!exists && amount < 1)
        return setSendMsg({ type: 'err', text: 'This account does not exist yet. Send at least 1 XLM to create it.' });
      if (memoRequired && !memo)
        return setSendMsg({ type: 'err', text: 'This account requires a memo (SEP-29). Add a memo before sending.' });
      setSendReview({
        publicKey, federation, exists, memo, memoType,
        amount: sendForm.amount,
        idempotencyKey: newIdempotencyKey(),
      });
    } catch (err) {
      setSendMsg({ type: 'err', text: getErrorMessage(err) });
    } finally {
      setReviewing(false);
    }
  }

  // Step 2: the user confirmed the reviewed transfer.
  async function handleSend() {
    if (!sendReview) return;
    if (twoFactorEnabled && !/^\d{6}$/.test(sendForm.totp))
      return setSendMsg({ type: 'err', text: 'Enter your 6-digit authenticator code.' });
    setSendMsg(null);
    setSending(true);
    try {
      const res = await api.withdrawFunds(sendReview.publicKey, sendReview.amount, {
        ...(sendReview.memo ? { memo: sendReview.memo, memo_type: sendReview.memoType } : {}),
        ...(twoFactorEnabled ? { totp: sendForm.totp } : {}),
      }, sendReview.idempotencyKey);
      setSendMsg({
        type: 'ok',
        text: `Sent ${res.amount} XLM${res.created ? ' and created the destination account' : ''}`,
        txHash: res.txHash,
      });
      setSendForm(EMPTY_FORM);
      setSendReview(null);
      onSent();
    } catch (e) {
      if (e.code === 'totp_required') onTwoFactorRequired?.();
      // Close the review so the next attempt gets a fresh idempotency key.
      setSendReview(null);
      setSendMsg({ type: 'err', text: getErrorMessage(e) });
    } finally {
      setSending(false);
    }
  }

  return {
    sendForm, setSendForm, updateSend, handleMax, cancelReview,
    sending, reviewing, sendMsg, sendReview,
    sendExceedsBalance, memoError, exchangeName, amountDecimalsError,
    handleReview, handleSend,
  };
}
