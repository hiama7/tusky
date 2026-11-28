// Confirms the Razorpay TEST keys work by creating a ₹1 test order. No money moves.
//   npm run payments:check
// Refuses live keys.
import { env } from '../src/config/env.js';
import { createOrder } from '../src/services/paymentGateway.js';

try {
  if (!env.razorpayEnabled) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.');
  if (!env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) throw new Error('These are not test keys. This check only runs with rzp_test_ keys.');
  const order = await createOrder({ amountPaise: 100, receipt: `check_${Date.now()}`, notes: { purpose: 'configuration check' } });
  console.log(`Test order created: ${order.id} (${order.status}).`);
  console.log(env.RAZORPAY_WEBHOOK_SECRET ? 'Webhook secret is set.' : 'RAZORPAY_WEBHOOK_SECRET is empty: webhooks will be rejected.');
} catch (err) {
  console.error(err?.error?.description || err.message);
  process.exitCode = 1;
}
