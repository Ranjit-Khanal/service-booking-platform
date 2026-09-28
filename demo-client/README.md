# SlotBook demo client

> This frontend is a reference client, not the core product. The backend in `../backend`
> runs and is fully usable without it.

A React + Vite app showing how an application consumes the SlotBook API: browse services,
list open slots, create a booking with an `Idempotency-Key`, look up bookings, and (with an
admin key) toggle failure injection on the Ops page.

## Run

With the full stack: `docker compose up --build` at the repository root → http://localhost:5173.

Against a backend running on the host:

```bash
npm install
VITE_API_BASE_URL=http://localhost:3000 VITE_API_KEY=dev-local-key-change-me npm run dev
```

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | API base URL (default `http://localhost:8080`) |
| `VITE_API_KEY` | Sent as `Authorization: Bearer …` |
| `VITE_ADMIN_API_KEY` | Sent as `X-Admin-Key` on `/api/admin/*` (Ops page) |

**These are compiled into public JavaScript.** Anyone who loads the page can read them.
That is acceptable for a local demo and wrong for production: a real integration keeps its
API key on its own server and calls SlotBook server-to-server.

## Where to look

- `src/api/client.ts`: fetch wrapper (auth header, request ID, error envelope)
- `src/api/bookings.ts`: booking calls
- `src/pages/ServiceDetailPage.tsx`: slot selection and booking submit (new
  `Idempotency-Key` per submit)

The Providers/Studios pages and ratings are static content from `src/data/catalogMedia.ts`;
the backend has no provider model.
