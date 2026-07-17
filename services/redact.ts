/**
 * Mask a phone number for operational logs, keeping only the last 4 digits so
 * calls can still be correlated without persisting full PII. Returns
 * '[redacted]' for empty/undefined input.
 */
export function maskPhone(value?: string | null): string {
  if (!value) return '[redacted]';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}
