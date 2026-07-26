// Quotes a field only when it needs it (contains a comma, quote, or
// newline), doubling any internal quotes — the standard CSV escaping rule.
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
