const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const gbpDetailFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return gbpFormatter.format(amount);
}

export function formatCurrencyDetailed(amount: number): string {
  return gbpDetailFormatter.format(amount);
}

export function formatCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000_000) {
    return `£${(amount / 1_000_000_000).toFixed(1)}bn`;
  }
  if (Math.abs(amount) >= 1_000_000) {
    return `£${(amount / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `£${(amount / 1_000).toFixed(0)}k`;
  }
  return formatCurrency(amount);
}

export function financialYearLabel(startYear: number): string {
  const endShort = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endShort}`;
}

export function financialYearFromDate(date: string): string {
  const d = new Date(date);
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1; // April = month 3
  return financialYearLabel(startYear);
}

export function formatMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
