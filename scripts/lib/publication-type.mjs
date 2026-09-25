/** Reject clearly non-payment datasets before discovery or legacy cleanup. */
export function isPaymentPublication(value) {
  return !/budget|outturn|statement.of.accounts|pay.multiple|senior.salar|contracts?[\s._-]*register|procurement.pipeline|business[\s._-]*rates|non[\s._-]*domestic[\s._-]*rates|council[\s._-]*tax|asset[\s._-]*register|organisational[\s._-]*chart/i.test(value);
}
