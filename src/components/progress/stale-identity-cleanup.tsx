"use client";

import { useEffect } from "react";
import {
  clearStoredCosmoIdentity,
  readStoredCosmoAddress,
  readStoredCosmoUsername,
} from "@/lib/cosmo-username-storage";
import type { ProgressIdentityResponse } from "@/lib/progress/types";

/**
 * Drops the saved Cosmo identity once it stops pointing at a real account.
 *
 * Rendered from the collection section's not-found boundary, which is exactly
 * where a stale save surfaces: the collection home redirects into the saved
 * username on every visit, so after a Cosmo rename the user bounces between
 * the home screen and this 404 with no way out — "go home" lands right back
 * on the home screen that redirects. Re-checking here makes the first 404
 * self-healing.
 *
 * The boundary also covers unknown members under a perfectly good username,
 * so never infer staleness from the 404 itself: ask Cosmo about the saved
 * name and only clear on a definitive answer.
 */
export function StaleIdentityCleanup() {
  useEffect(() => {
    const nickname = readStoredCosmoUsername();
    if (!nickname) return;
    const savedAddress = readStoredCosmoAddress();

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(
          `/api/progress/resolve/${encodeURIComponent(nickname)}`,
          { signal: controller.signal },
        );

        // 404 (no such user) and 400 (no longer a valid nickname at all) are
        // the definitive answers. A 429/503/network blip must leave a still
        // valid save alone, so anything else is left untouched.
        if (res.status === 404 || res.status === 400) {
          clearStoredCosmoIdentity();
          return;
        }
        if (!res.ok) return;

        const data = (await res.json()) as ProgressIdentityResponse;
        // The name resolves, but to a different wallet — whoever claimed it
        // after the rename. Just as stale, and worse: following it would open
        // a stranger's collection as if it were the user's own.
        if (savedAddress && data.address.toLowerCase() !== savedAddress) {
          clearStoredCosmoIdentity();
        }
      } catch {
        // Aborted or offline — the next 404 gets another chance.
      }
    })();

    return () => controller.abort();
  }, []);

  return null;
}
