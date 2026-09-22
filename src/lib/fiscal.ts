/** UK financial years run from 1 April to 31 March. Keep five including current. */
export function fiscalWindow(now = new Date()) {
  const currentStart = now.getUTCFullYear() - (now.getUTCMonth() < 3 ? 1 : 0);
  const firstStart = currentStart - 4;
  return {
    start: `${firstStart}-04-01`,
    endExclusive: `${currentStart + 1}-04-01`,
    through: now.toISOString().slice(0, 10),
    labels: Array.from({ length: 5 }, (_, i) => fiscalLabel(`${currentStart - i}-04`)),
  };
}
export function fiscalLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "";
  const year = Number(month.slice(0, 4)) - (Number(month.slice(5)) < 4 ? 1 : 0);
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
