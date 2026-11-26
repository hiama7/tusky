// Razorpay SDK client. Keys come only from the environment. The secret never leaves
// the server; only the public key id is returned to the browser with an order.
import Razorpay from 'razorpay';
import { env } from './env.js';

let client = null;

export function getRazorpay() {
  if (!env.razorpayEnabled) return null;
  if (!client) client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return client;
}
