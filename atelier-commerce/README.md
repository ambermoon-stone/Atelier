# ATELIER Commerce

A server-rendered, SQLite-backed premium storefront with a vanilla ES-module client and a protected admin workspace.

## Prerequisites

- Node.js 20 or newer and npm
- Windows, macOS, or Linux; `better-sqlite3` may compile on unsupported Node/platform combinations

## How to run locally

```sh
cd atelier-commerce
npm install
cp .env.example .env
npm run dev
```

In Windows PowerShell, use `Copy-Item .env.example .env` in place of `cp`.

Open http://localhost:3000. The database is created and seeded automatically on first startup.

`npm run dev` -> http://localhost:3000

Admin: http://localhost:3000/admin

Default development admin: `admin@atelier.test` / `ChangeMe!123`. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a strong `JWT_SECRET` before deployment. Admin credentials are created only when the database has no users; changing the environment password does not rewrite an existing account.

## Useful scripts

- `npm run dev` starts Node's watch-mode server.
- `npm start` starts the production server.
- `npm run smoke` starts an isolated server on a random port and exercises catalog, guest cart, coupon, COD checkout, account/admin authorization, SEO, and invoice routes.

## Payments

Cash on Delivery is enabled by default and creates a confirmed order. SSLCommerz, bKash, and Nagad remain unavailable until their sandbox credentials are set in `.env`; bKash and Nagad also require `PAYMENT_WEBHOOK_SECRET`. Set the provider sandbox values in `.env` (`SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWD`, `BKASH_APP_KEY`/`BKASH_APP_SECRET`/`BKASH_USERNAME`/`BKASH_PASSWORD`, or `NAGAD_MERCHANT_ID`/`NAGAD_PUBLIC_KEY`/`NAGAD_PRIVATE_KEY`) and use the matching sandbox API URL. Configure callback URLs at `/api/payments/:provider/callback`, keep secrets server-side, and send HMAC-SHA256 signed bKash/Nagad callbacks including order number, amount, and currency. SSLCommerz payments are checked with its validation API. Test failed and successful verification before production; a redirect alone never marks an order paid. Hosted sandbox callbacks must be reachable over HTTPS. No gateway payment is simulated.

## Deployment notes

Use a persistent writable volume for `DATABASE_FILE` and `public/uploads`, set `NODE_ENV=production`, `APP_URL`, and a high-entropy `JWT_SECRET`, terminate TLS at a trusted proxy, and back up the SQLite database. Restrict admin credentials, configure payment-provider callbacks and secrets, and review tax, shipping, privacy, and refund policies for your jurisdiction. The default SQLite setup is intended for a single application instance.