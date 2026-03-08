# Authorization Code Flow (OAuth2)

This guide shows the steps and HTTP endpoints used in the OAuth2 Authorization Code flow for Google APIs. Do NOT include client secrets or tokens in source control.

1. Authorize URL (user-consent)

- Endpoint:
  https://accounts.google.com/o/oauth2/v2/auth

- Required query params:
  - client_id
  - redirect_uri
  - response_type=code
  - scope (space-separated)
  - access_type=offline (to receive a refresh_token)
  - prompt=consent (recommended to guarantee refresh_token)

Example scopes for Sheets read-only:
- https://www.googleapis.com/auth/spreadsheets.readonly

2. Exchange authorization code for tokens

- Endpoint: https://oauth2.googleapis.com/token
- Method: POST
- Content-Type: application/x-www-form-urlencoded
- Required fields:
  - code (the code from the consent redirect)
  - client_id
  - client_secret
  - redirect_uri
  - grant_type=authorization_code

Example (curl):

```
curl -X POST https://oauth2.googleapis.com/token \
  -d code=AUTH_CODE_HERE \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d redirect_uri=YOUR_REDIRECT_URI \
  -d grant_type=authorization_code
```

Response contains `access_token`, `expires_in`, and `refresh_token` (if requested with `access_type=offline`).

3. Refresh an access token

- Endpoint: https://oauth2.googleapis.com/token
- Method: POST
- Required fields:
  - client_id
  - client_secret
  - refresh_token
  - grant_type=refresh_token

Example (curl):

```
curl -X POST https://oauth2.googleapis.com/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d refresh_token=REFRESH_TOKEN_HERE \
  -d grant_type=refresh_token
```

4. Using tokens with `SheetsLoader`

- Short-lived: set `SHEETS_LOADER_ACCESS_TOKEN` env var for a quick run.
- Long-lived: persist `refresh_token` in a secure store and use `google-auth-library`'s `OAuth2Client` to refresh automatically and pass it as `authClient` to `SheetsLoader`.

Security notes:
- Never store `client_secret` or `refresh_token` in public source control.
- Use a secrets manager (Vault, AWS Secrets Manager, etc.) in production.
