export interface MoneyProfile {
  currency: string;
  precision: number;
  scale: number;
}

const profiles = {
  USD: { currency: "USD", precision: 20, scale: 2 },
  EUR: { currency: "EUR", precision: 20, scale: 2 },
  GBP: { currency: "GBP", precision: 20, scale: 2 },
  JPY: { currency: "JPY", precision: 20, scale: 0 },
  KWD: { currency: "KWD", precision: 20, scale: 3 },
} as const satisfies Record<string, MoneyProfile>;

export function moneyProfile(currency: string): MoneyProfile | undefined {
  return profiles[currency as keyof typeof profiles];
}

export function moneyType(profile: MoneyProfile): string {
  return `money:${profile.currency}:${profile.precision}:${profile.scale}`;
}

export function isMoneyType(type: string): boolean {
  return type.startsWith("money:");
}

export function moneyProfileFromType(type: string): MoneyProfile | undefined {
  const match = /^money:([A-Z]{3}):([0-9]+):([0-9]+)$/.exec(type);
  if (!match) return undefined;
  const profile = moneyProfile(match[1]!);
  if (!profile || profile.precision !== Number(match[2]) || profile.scale !== Number(match[3])) return undefined;
  return profile;
}

export function moneyMagnitudeLimit(profile: MoneyProfile): string {
  return `1${"0".repeat(profile.precision - profile.scale)}`;
}

export function validateMoneyAmount(amount: string, profile: MoneyProfile): string | undefined {
  const match = /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount);
  if (!match) return "amount must be a plain base-10 decimal without separators or exponent notation";
  const fractionalDigits = match[2]?.length ?? 0;
  if (fractionalDigits > profile.scale) return `${profile.currency} permits at most ${profile.scale} fractional digits`;
  const integralDigits = match[1] === "0" ? 1 : match[1]!.length;
  const maximumIntegralDigits = profile.precision - profile.scale;
  if (integralDigits > maximumIntegralDigits) return `${profile.currency} permits at most ${maximumIntegralDigits} integral digits`;
  return undefined;
}
