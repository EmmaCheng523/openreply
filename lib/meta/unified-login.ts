import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
async function graph<T>(path: string, accessToken: string, fields: string, after?: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${path}`);
  url.searchParams.set("fields", fields);
  if (after) url.searchParams.set("after", after);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Unified Login account lookup failed (HTTP ${response.status})`);
  return data as T;
}

export async function getUnifiedAccount(accessToken: string) {
  const target = requireEnv("META_INSTAGRAM_USERNAME").trim().replace(/^@/, "").toLowerCase();
  const business = await graph<{ client_business_id?: string }>("me", accessToken, "client_business_id");
  if (!business.client_business_id) throw new Error("Unified Login did not share a client business ID");
  const seen = new Set<string>();
  let sharedCount = 0;
  let unnamedCount = 0;
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await graph<{
      data?: { id: string; username: string }[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>("me/assigned_instagram_accounts", accessToken, "id,username", after);
    sharedCount += result.data?.length ?? 0;
    unnamedCount += result.data?.filter((row) => !row.username).length ?? 0;
    const account = result.data?.find((row) => row.username?.trim().replace(/^@/, "").toLowerCase() === target);
    if (account) {
      if (!/^\d+$/.test(account.id)) throw new Error("Unified Login returned an invalid Instagram account ID");
      return { ...account, clientBusinessId: business.client_business_id };
    }
    if (!result.paging?.next) break;
    const cursor = result.paging.cursors?.after;
    if (!cursor || seen.has(cursor)) throw new Error("Unified Login account pagination did not advance");
    seen.add(cursor);
    after = cursor;
  }
  // A self-hosted installation can pin an account independently verified in
  // Meta's Connected Apps UI. Still require this token to read that exact IG
  // profile and require its ID and username to match; never infer ownership
  // from the configured ID alone when Meta's assigned-assets edge is empty.
  const configuredId = process.env.META_INSTAGRAM_ID?.trim();
  if (configuredId) {
    if (!/^\d+$/.test(configuredId)) throw new Error("Invalid configured Instagram account ID");
    const profile = await graph<{ id?: string; username?: string }>(configuredId, accessToken, "id,username");
    if (profile.id !== configuredId || typeof profile.username !== "string" || profile.username.trim().replace(/^@/, "").toLowerCase() !== target) {
      throw new Error("The configured Instagram ID and username do not match the authorized profile");
    }
    return { id: configuredId, username: profile.username, clientBusinessId: business.client_business_id };
  }
  throw new Error(`The configured Instagram account was not shared (accounts=${sharedCount}, missing usernames=${unnamedCount}). Check the selected business asset and app role.`);
}

export function tokenExpiry(expiresIn: number): Date | null {
  if (!Number.isFinite(expiresIn) || expiresIn < 0) throw new Error("Invalid token expiry");
  return expiresIn === 0 ? null : new Date(Date.now() + expiresIn * 1000);
}
