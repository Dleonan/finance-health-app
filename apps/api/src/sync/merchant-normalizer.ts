const suffixes = [/\s+SAO\s+PAULO\b/gi, /\*\d+/g, /#\d+/g, /\s+BR\b/gi];

export function normalizeMerchant(value: string | null) {
  if (!value) return null;
  const normalized = suffixes
    .reduce((result, suffix) => result.replace(suffix, ''), value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized || null;
}
