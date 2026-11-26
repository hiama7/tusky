// Money helpers. Prisma returns DECIMAL columns as Decimal instances — never use floats for maths.
import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal;
export const toDecimal = (v) => new Prisma.Decimal(v ?? 0);

/** Rupees → paise for Razorpay (exact for 2 decimal places). */
export const toPaise = (amount) => toDecimal(amount).mul(100).toDecimalPlaces(0).toNumber();

/** Decimal → JSON number for API responses (display only, rounded to 2 dp). */
export const money = (v) => (v === null || v === undefined ? null : Number(toDecimal(v).toFixed(2)));
