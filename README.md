# GLAMORA – Beauty & Jewellery Marketplace

GLAMORA is now a working full-stack prototype built on the original frontend.

## Stack

- **Frontend:** Existing HTML + CSS + vanilla JavaScript
- **Backend:** Node.js built-in HTTP server
- **Database:** SQLite via Node 22's built-in `node:sqlite`
- **Authentication:** JWT-style signed tokens + `crypto.scrypt` password hashing
- **No npm packages are required** for the backend.

## What is connected

- Customer registration and login
- Admin login and protected admin routes
- SQLite users database
- Product catalogue stored in SQLite
- Dynamic shop and product detail pages
- Buy/rent cart stored in the browser
- Checkout and order creation in SQLite
- Stock reduction after orders
- Customer dashboard with real orders/listings
- Seller listing submission + image storage as data URLs for the prototype
- Admin order status updates
- Admin product stock updates
- Admin listing verification; approving a listing creates a marketplace product
- Admin dashboard statistics

## Run the whole website

### Windows

1. Install **Node.js 22 or newer**.
2. Extract the `glamora` folder.
3. Open Command Prompt or PowerShell inside the `glamora` folder.
4. Run:

```bash
node server.js
```

5. Open:

```text
http://localhost:3000
```

Keep the terminal running while you use the site.

### VS Code

Open the `glamora` folder in VS Code, then open the integrated terminal and run:

```bash
node server.js
```

Do **not** use Live Server for this version because the backend API is served by `server.js`.

## Demo admin account

```text
Email:    admin@glamora.in
Password: Admin@123
```

Change this before deploying publicly.

## Database

The first time the server starts it creates:

```text
data/glamora.db
```

The database is seeded with sample GLAMORA products.

## Important

This is a functional development prototype, not a production payment system. Payment choices are recorded as UPI/Card/COD selections; no real payment gateway is connected. Before public deployment, use HTTPS, a strong `GLAMORA_JWT_SECRET`, a real payment provider, server-side validation/rate limiting, proper image/object storage, backups, and production authentication/session practices.
