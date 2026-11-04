const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

export function formatSigned(value: number, fractionDigits = 2): string {
  if (value > 0) return `+${value.toFixed(fractionDigits)}`;
  if (value < 0) return value.toFixed(fractionDigits);
  return (0).toFixed(fractionDigits);
}

export function formatImpact(value: number): string {
  return formatSigned(value, 2);
}

export function formatCoefficient(value: number): string {
  return value.toFixed(2);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatMetric(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function effortDescriptor(effort: number): string {
  if (effort <= 2) return 'Minimal force';
  if (effort <= 4) return 'Light force';
  if (effort <= 6) return 'Steady force';
  if (effort <= 8) return 'Heavy force';
  return 'Maximum force';
}

export const IMPACT_BAND_LABEL = {
  counter: 'Counter-productive',
  zero: 'Zero displacement',
  low: 'Low impact',
  moderate: 'Moderate impact',
  high: 'High impact',
  exceptional: 'Exceptional impact',
} as const;
