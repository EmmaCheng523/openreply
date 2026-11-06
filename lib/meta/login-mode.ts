// This self-hosted instance uses one Meta login mode. Existing legacy tokens
// must be reconnected before enabling unified mode on an existing deployment.
export function usesUnifiedLogin(): boolean {
  return process.env.META_LOGIN_MODE === "unified";
}
