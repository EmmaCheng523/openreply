# Unified Login for new Meta apps

This fork supports Meta's October 2026 Unified Login flow. References:
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication

Set the same `META_LOGIN_MODE=unified` and `META_GRAPH_API_VERSION=v27.0` on web and worker. Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `META_LOGIN_CONFIG_ID`, and `META_INSTAGRAM_USERNAME` on the web app. The last value is the exact intended username; connection fails if that account was not shared. Configure a system-user token with no expiry. Keep the existing encryption key, OAuth secret and webhook verify token unchanged. The Meta App secret verifies webhooks.

Register `/api/instagram/callback` on the public web origin. Request only `instagram_basic`, `instagram_manage_messages` and `instagram_manage_comments` for comment-to-DM. Insights need the optional `instagram_manage_insights` permission. Advertising and publishing permissions are unnecessary for this workflow.

Run `npm run db:generate` and `npm run db:migrate`. Client business ID and config ID are stored with the encrypted token. A zero/omitted token expiry is stored as null and is not sent to the legacy Instagram refresh endpoint. Revoked tokens must be reconnected. Expiring system tokens require reconnecting before expiry; automated system-token rotation is not implemented.

Login mode is deployment-wide: do not mix old Instagram Login tokens with Unified Login tokens. Reconnect all Meta accounts when changing modes. Legacy deployments retain their original behavior when `META_LOGIN_MODE` is unset. The account ID is explicitly passed for profile/media requests because `/me` identifies the system user in unified mode.

Before calling setup complete, confirm healthy web/worker, approved tester invitation, webhook delivery, a real second-account comment, a SENT DM log and an opening tutorial link. Unit tests cannot prove Meta account eligibility or live delivery.
