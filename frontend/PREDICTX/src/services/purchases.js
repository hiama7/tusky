// =============================================================================
// Purchases, payments, wallet and subscriptions.
//
// Online payments use Razorpay Checkout: the server creates the order (with the
// price from MySQL), the browser opens Checkout, and the server verifies the
// signature and the payment with Razorpay before anything is unlocked.
// =============================================================================
import { ApiError, get, post, put } from './api';

export const getDashboard = () => get('/users/me/dashboard');
export const getPurchases = () => get('/users/me/purchases').then((d) => d.items);
export const getUserTransactions = (type) => get('/users/me/transactions', { query: { type, limit: 100 } }).then((d) => d.items);
export const getWallet = () => get('/users/me/wallet');
export const setFavourites = (sports) => put('/users/me/favourites', { sports });

export const getPlans = () => get('/subscriptions/plans', { scope: 'none' }).then((d) => d.plans);
export const getSubscription = () => get('/subscriptions/me');
export const cancelSubscription = () => post('/subscriptions/cancel');

/** Pays from the TUSKY wallet balance. item = { type: 'PREDICTION', matchId } | { type: 'SUBSCRIPTION', planId } */
export const payWithWallet = (item) => post('/payments/wallet', item);

let checkoutScript;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) {
    checkoutScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { checkoutScript = null; reject(new ApiError('Could not load the payment window. Check your connection.', 0)); };
      document.body.appendChild(s);
    });
  }
  return checkoutScript;
}

/**
 * Runs a full Razorpay payment.
 * item = { type: 'PREDICTION', matchId } | { type: 'SUBSCRIPTION', planId } | { type: 'WALLET_TOPUP', amount }
 * Resolves with the server's verification result; rejects with ApiError on failure/cancel.
 */
export async function payOnline(item, { method } = {}) {
  const { order } = await post('/payments/orders', item);
  await loadCheckout();
  return new Promise((resolve, reject) => {
    let settled = false;
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'TUSKY',
      description: order.description,
      prefill: { ...order.prefill, ...(method ? { method } : {}) },
      theme: { color: '#39FF14' },
      handler: async (response) => {
        settled = true;
        try {
          resolve(await post('/payments/verify', response));
        } catch (err) {
          reject(err);
        }
      },
      modal: {
        ondismiss: () => {
          if (settled) return;
          settled = true;
          post('/payments/failure', { orderId: order.orderId, reason: 'Checkout closed by user' }).catch(() => {});
          reject(new ApiError('Payment cancelled. No money was taken.', 499));
        },
      },
    });
    rzp.on('payment.failed', (resp) => {
      if (settled) return;
      settled = true;
      post('/payments/failure', { orderId: order.orderId, reason: resp?.error?.description }).catch(() => {});
      reject(new ApiError(resp?.error?.description || 'Payment failed. No money was taken.', 402));
    });
    rzp.open();
  });
}
