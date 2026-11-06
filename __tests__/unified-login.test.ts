import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthorizationUrl, exchangeCodeForToken } from "../lib/meta/oauth";
import { getUnifiedAccount, tokenExpiry } from "../lib/meta/unified-login";
import { getMissingInstagramOAuthEnv } from "../lib/env";
import { getUserInfo, getUserMedia, sendPrivateReply, refreshLongLivedToken } from "../lib/meta/client";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.stubEnv("META_LOGIN_MODE", "unified");
  vi.stubEnv("FACEBOOK_APP_ID", "123");
  vi.stubEnv("FACEBOOK_APP_SECRET", "server-secret");
  vi.stubEnv("META_LOGIN_CONFIG_ID", "456");
  vi.stubEnv("META_INSTAGRAM_USERNAME", "@intended_account");
  vi.stubEnv("META_INSTAGRAM_ID", "");
  vi.stubEnv("META_GRAPH_API_VERSION", "v27.0");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Unified Login", () => {
  it("keeps signed state and uses config instead of legacy scopes or secrets in authorize URL", () => {
    const url = new URL(getAuthorizationUrl("https://example.com/api/instagram/callback", "signed-state"));
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("config_id")).toBe("456");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("requires the intended account and Meta config before starting OAuth", () => {
    vi.stubEnv("META_INSTAGRAM_USERNAME", "");
    expect(getMissingInstagramOAuthEnv()).toContain("META_INSTAGRAM_USERNAME");
  });

  it("exchanges the code on the server without using the Instagram token endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ access_token: "system-token" }));
    vi.stubGlobal("fetch", fetch);
    expect(await exchangeCodeForToken("code", "https://example.com/callback")).toMatchObject({ accessToken: "system-token", expiresIn: 0 });
    expect(new URL(String(fetch.mock.calls[0][0])).origin).toBe("https://graph.facebook.com");
  });

  it("does not expose upstream token-bearing errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { message: "secret-token" } }, 400)));
    await expect(exchangeCodeForToken("code", "https://example.com/callback")).rejects.toThrow("Unified Login token exchange failed (HTTP 400)");
  });

  it("does not expose token exchange URLs in network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://meta.invalid/?client_secret=server-secret")));
    await expect(exchangeCodeForToken("code", "https://example.com/callback")).rejects.toThrow("could not reach Meta");
  });

  it("selects only the intended IG account and paginates on the trusted host", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ client_business_id: "business" }))
      .mockResolvedValueOnce(response({ data: [{ id: "1", username: "other" }], paging: { next: "https://untrusted.invalid/token", cursors: { after: "next" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "2", username: "intended_account" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await getUnifiedAccount("token")).toMatchObject({ id: "2", clientBusinessId: "business" });
    for (const [url, options] of fetch.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://graph.facebook.com");
      expect(String(url)).not.toContain("access_token");
      expect(options.headers.Authorization).toBe("Bearer token");
    }
  });

  it("fails closed when only a different account was shared", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ client_business_id: "business" }))
      .mockResolvedValueOnce(response({ data: [{ id: "1", username: "other" }] })));
    await expect(getUnifiedAccount("token")).rejects.toThrow("configured Instagram account was not shared");
  });

  it("verifies a pinned account with the token when Meta returns no assigned accounts", async () => {
    vi.stubEnv("META_INSTAGRAM_ID", "2");
    const fetch = vi.fn().mockResolvedValueOnce(response({ client_business_id: "business" }))
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ id: "2", username: "intended_account" }));
    vi.stubGlobal("fetch", fetch);
    expect(await getUnifiedAccount("token")).toMatchObject({ id: "2", username: "intended_account" });
    expect(new URL(String(fetch.mock.calls[2][0])).pathname).toBe("/v27.0/2");
  });

  it("rejects a pinned ID when the authorized profile has a different username", async () => {
    vi.stubEnv("META_INSTAGRAM_ID", "2");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ client_business_id: "business" }))
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ id: "2", username: "other" })));
    await expect(getUnifiedAccount("token")).rejects.toThrow("do not match");
  });

  it("uses explicit IG IDs for profiles/media and Facebook Graph for private replies", async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ id: "2", data: [] }));
    vi.stubGlobal("fetch", fetch);
    await getUserInfo("token", "2");
    await getUserMedia("token", 25, "2");
    await sendPrivateReply("token", "2", "comment", "tutorial");
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/v27.0/2", "/v27.0/2/media", "/v27.0/2/messages"]);
    expect(JSON.parse(fetch.mock.calls[2][1].body).recipient).toEqual({ comment_id: "comment" });
    await expect(getUserInfo("token")).rejects.toThrow("requires an Instagram account ID");
  });

  it("keeps never-expiring system tokens out of legacy refresh", async () => {
    expect(tokenExpiry(0)).toBeNull();
    expect(tokenExpiry(3600)).toBeInstanceOf(Date);
    expect(() => tokenExpiry(-1)).toThrow();
    await expect(refreshLongLivedToken("token")).rejects.toThrow("Reconnect");
  });

  it("preserves legacy login when unified mode is disabled", () => {
    vi.stubEnv("META_LOGIN_MODE", "");
    vi.stubEnv("INSTAGRAM_APP_ID", "legacy");
    expect(new URL(getAuthorizationUrl("https://example.com/callback", "state")).origin).toBe("https://www.instagram.com");
  });
});
