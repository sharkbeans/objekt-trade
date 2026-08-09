const COSMO_USERNAME_STORAGE_KEYS = [
  "cosmousername",
  "cosmoUsername",
  "progress-last-nickname",
] as const;
const COSMO_ADDRESS_STORAGE_KEY = "progress-last-address";

// Marker the by-wallet resolver adds when it bounces back to the collection
// home because the address doesn't map to a live Cosmo nickname. The home
// screen uses it to drop the stored address instead of redirecting straight
// back into the same dead end.
export const UNRESOLVED_WALLET_PARAM = "wallet";
export const UNRESOLVED_WALLET_MARKER = "unknown";

export function readStoredCosmoUsername(): string | null {
  if (typeof window === "undefined") return null;

  for (const key of COSMO_USERNAME_STORAGE_KEYS) {
    const value = localStorage.getItem(key)?.trim();
    if (value) return value;
  }

  return null;
}

export function readStoredCosmoAddress(): string | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(COSMO_ADDRESS_STORAGE_KEY)?.trim();
  return value && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
}

// Drop the whole saved identity. Username and address are always written
// together by storeCosmoUsername(), so they describe one Cosmo account and go
// stale together — clearing only one half leaves the collection home
// redirecting into the other half's dead end.
export function clearStoredCosmoIdentity(): void {
  if (typeof window === "undefined") return;
  for (const key of COSMO_USERNAME_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  localStorage.removeItem(COSMO_ADDRESS_STORAGE_KEY);
}

export function storeCosmoUsername(value: string, address?: string): void {
  if (typeof window === "undefined") return;

  const trimmed = value.trim();
  if (!trimmed) return;

  for (const key of COSMO_USERNAME_STORAGE_KEYS) {
    localStorage.setItem(key, trimmed);
  }
  if (address && /^0x[0-9a-f]{40}$/i.test(address)) {
    localStorage.setItem(COSMO_ADDRESS_STORAGE_KEY, address.toLowerCase());
  }
}
