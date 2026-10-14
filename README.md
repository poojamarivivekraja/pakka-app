# Pakka

Pakka is an order copilot for small businesses that take custom orders on WhatsApp Business: home bakers, jewellery makers, saree sellers, cloud kitchens' direct orders. It reads the order conversations and keeps one live order ticket per order, with every detail linked to the message it came from, a history of changes, and flags only for the things that genuinely need the owner. It never sends messages to customers. The prototype is demoed with a home bakery; business profiles make it generic.

## Quick start for reviewers
- Live app: [live link]
- Design: [Figma link] · Opportunity map: [FigJam link] · PRD: [PRD link]
- The Orders screen shows a seeded demo: a home bakery with seven synthetic scenarios.
- Try it: open /simulator, enter the demo passcode (it's in the submission notes), choose S2 "Change agreed in chat", and press "Send next message" repeatedly. A customer's request waits as pending until the business agrees, and then becomes "Updated from chat". Open Rahul's order to see sources, payments and history.
- Without the passcode the app is read-only.

> Everything here uses **synthetic data only**. Don't connect real customer chats to a prototype running on a free-tier model.

## How it works

1. **A message comes in.** From the simulator (scripted conversations) or, later, a live WhatsApp webhook. Both call the same function, `processMessage()`.
2. **The model reads it.** One message at a time, with the customer's open orders and the last 15 messages as context. It returns JSON: what the message means, which order it belongs to, and the details it states, each with the exact words it relied on.
3. **Code applies the rules.** The model never writes to the database. Plain code checks every quote against the message, fills empty fields, turns unagreed changes into pending requests, flags conflicts and payment mismatches, recomputes missing fields, the balance and the status.
4. **The owner reviews.** The Orders screen shows what needs attention. Each order page shows every detail with a "Source" link to the chat, "Updated from chat" notes, and what needs review. The owner can edit anything and confirm.

## Run it locally

You need Node.js 20.9 or newer and a Supabase project.

1. In Supabase, run `docs/SCHEMA.sql` in the SQL editor to create the tables.
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in the values (see below). Never commit `.env.local`.
4. `npm run dev`, then open <http://localhost:3000/simulator>, enter your passcode, and send a scripted conversation. If the Orders screen shows an error instead, the Supabase URL or key in `.env.local` is wrong.
5. To restore the demo story at any time, run `npm run seed:demo`. It clears the scenario data and replays s1, s7, s2, s6, s3, s4 and s5 (a few minutes, it calls the model).

## Environment variables

Names only. Put the values in `.env.local` (and in your host's settings when you deploy).

| Variable | Needed | What it is |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google Gemini API key |
| `LLM_PROVIDER` | yes | `gemini` (the only provider built so far) |
| `LLM_MODEL` | yes | the model's ID, e.g. a Flash model |
| `LLM_THINKING` | no | `off`, `low` or `default`. Unset means the lowest the model allows |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://<project>.supabase.co` and nothing after it |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-side only; never shown to the browser |
| `DEMO_PASSCODE` | yes | protects the simulator and every route that calls the model |
| `DEMO_TODAY` | no | `YYYY-MM-DD`; the date the app treats as "today". Unset means the real date |
| `SCENARIO_DELAY_MS` | no | scripts only: pause between messages (default 5000) |
| `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | live mode only | the Cloud API access token (to download images), the verify token you choose when registering the webhook, and your Meta app's secret (to check each request's signature). Without the app secret the webhook refuses everything |
| `WHATSAPP_PHONE_NUMBER_ID` | live mode, recommended | your business number's ID; messages sent to any other number are ignored |
| `WHATSAPP_GRAPH_VERSION` | no | Graph API version used to download images (default `v23.0`) |

### Deploying to Vercel

Set the six required variables above, plus `DEMO_TODAY` and `LLM_THINKING` if you want them, for Production and Preview. For live WhatsApp mode also set the `WHATSAPP_*` variables. The simulator's sample images are shipped inside the API functions (`outputFileTracingIncludes` in `next.config.ts`), so nothing else is needed. The `maxDuration` of the message route is 60 seconds.

## Using the simulator

Open `/simulator` (you'll be asked for the passcode once).

- **Scenario picker:** choose S1 to S7 (described below). The chat panel shows the conversation so far.
- **Send next message:** sends the next scripted message through `processMessage()`, exactly as a live message would be.
- **Reset scenario:** clears that scenario's customer, orders and chat. Scenarios that continue another (S6, S7) share its customer, so resetting them clears the whole thread.
- **Custom message:** type a message as the customer or as the business and send it.
- **Side panel:** shows the order's fields, flags, update notes, pending requests, images and payments after each message.
- **Simulate sync paused:** shows the "Sync paused" banner on every screen.
- Open the Orders screen (`/`) in another tab: new Needs review items pop up as a toast there.

## Live WhatsApp mode (optional)

The simulator is the demo. Live mode lets real WhatsApp messages feed the same pipeline through `/api/webhook`.

1. In your Meta app (WhatsApp, Cloud API), set the webhook callback URL to `https://<your-domain>/api/webhook` and the verify token to your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
2. Set the `WHATSAPP_*` variables in Vercel.
3. Send a message to your business number from another phone.

What it does: it checks Meta's `X-Hub-Signature-256` signature on every request (anything unsigned is refused with 403), answers `200` straight away, then processes the message in the background (Next's `after()`, which uses Vercel's `waitUntil`). A message Meta delivers twice is recorded once. Text goes straight into the pipeline; images are downloaded through the Graph API into the private `media` bucket; messages Pakka can't read (voice notes, stickers, locations, error 131051 or 131060) raise "1 message couldn't be read".

**Try it without Meta:** with the app running, `npm run webhook:test -- --type=text --text="Need a 1 kg mango cake for Saturday"` sends a signed, made-up message to your own app (set any `WHATSAPP_APP_SECRET` in `.env.local` first). Use `--type=unsupported` to try the unreadable-message path without a model call. It creates a synthetic customer named "Webhook Demo".

This route reaches the model but can't carry the demo passcode (Meta calls it), so the request signature is its gate instead. `npm run check` verifies that nothing reaches the model without one or the other.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Runs every automated check: no secrets in the repo, every model route is passcode-gated, profiles, the pipeline rules, owner actions, the screens' logic, and one real model call. Prints PASS or FAIL per check and needs `.env.local` |
| `npm run scenario -- s1` | Clears that scenario's customer, sends each message through the pipeline with a 5-second pause, prints the orders, flags, notes and payments, then PASS or FAIL per expected check, with the model name and total tokens and latency. S6 and S7 continue S2 and S1, so run those first; they never clear data |
| `npm run eval` | Runs all seven scenarios three times (resetting the data before each repeat) and writes [`docs/EVAL_RESULTS.md`](docs/EVAL_RESULTS.md): pass rate per check, tokens, latency and estimated cost. Takes a while because of the pauses |
| `npm run dev` / `build` / `start` / `lint` | the usual Next.js commands |

`npm run check:webhook` tests the webhook (signature, parsing, recording each kind of message) with Meta and the model stubbed. `npm run check:passcode` proves the AI routes refuse a request without the passcode (the app must be running). Individual checks can be run on their own, for example `npm run check:pipeline`.

## Business profiles

A profile is one JSON file in `src/config/profiles/`. Two exist: `bakery.json` and `saree.json`. The active one is stored in the `settings` table and chosen on the "Your business" screen; it applies to new orders.

To add one:

1. Copy `bakery.json` to `src/config/profiles/<id>.json`.
2. Set `id`, `name` (shown in Settings) and `tracks_for` (finishes "What Pakka tracks for …").
3. Keep all the universal fields (`occasion`, `items_summary`, `due_date`, `due_time`, `fulfilment`, `address`, `tracking_number`, `price_agreed`, `advance_requested`), then add your own. Each field needs `key`, `label`, `short_label` (lower-case, used in sentences), `description` (one or two plain sentences with examples that don't match your test data; this is sent to the model, so it is how you tell it what belongs in the field), `type` (`text`, `exact_text`, `measurement`, `money`, `date`, `time`, `enum`, `items`) and `required`. Use `required_when` for conditional fields, and `options` for `enum`.
4. Register it in `src/config/profiles/index.ts` (add it to `PROFILES`, and remove it from `COMING_SOON_PROFILES` if it was listed there).
5. Run `npm run check:profiles`, then write scenarios for it and run `npm run eval`.

## Synthetic data

- **Seven scenarios** (`src/data/scenarios/s1.json` to `s7.json`), all for the home bakery, with invented customers and phone numbers:
  S1 clean order · S2 a change the business agreed to in chat · S3 an edited message · S4 two orders from one customer · S5 a price conflict and gaps · S6 a payment mismatch (continues S2) · S7 small talk (continues S1). Each has an `expected` list of automated checks.
- **Payment screens:** `public/samples/payment_700.png` and `payment_500.png` are mock UPI success screens generated by `scripts/make-samples.ts` (fake payee, fake reference numbers, a large diagonal "SAMPLE" watermark).
- **Reference photos:** `public/samples/reference_jungle.jpg` and `reference_floral.jpg` are free photos from Unsplash, resized to about 1000px wide.
  - Photo 1 (jungle cake): `credits given for image`
  - Photo 2 (floral cake): `credits given for image`

## Known limitations

- **A WhatsApp test number can't receive the business's own replies.** Without a WhatsApp Business app, the business's messages don't arrive as echoes, so the simulator covers both sides of the conversation.
- **Messages WhatsApp doesn't deliver.** Some messages reach the webhook with no content (error 131051 for types the Cloud API doesn't support, 131060 for a customer's first message to a number that also runs the WhatsApp Business app). Pakka flags "1 message couldn't be read" and asks the owner to check WhatsApp. Per Meta's documentation, edited messages are currently delivered as "unsupported" too, so a customer's edit in live mode shows up as an unreadable message rather than as the new text; the edit and delete handling is built for when Meta sends them (deletes are only sent for numbers that also use the WhatsApp Business app). The simulator covers all of these.
- **Not built:** voice notes, Instagram, group chats, helper accounts, and real push notifications (the toast is in-app only). Aggregator orders (Swiggy, Zomato) are out of scope. Payments are never verified: a screenshot is shown as "not verified" until the owner marks it received.
- **The live webhook is built and tested against made-up payloads, but not yet against Meta's real servers.** It follows Meta's published formats; expect to adjust once real traffic arrives. The Graph API version it uses to download images is a default you may need to change. Messages from one customer that arrive at the same moment are processed independently, so two near-simultaneous messages could briefly step on each other.
- **Free-tier model, synthetic data only.** The prototype is built for a free-tier model and fake conversations. Real customers' chats need a paid tier (free-tier terms can allow the provider to use prompts), your own data-handling review, and the app protected beyond the single demo passcode: only the simulator and the model routes check it today.
- **The sync-paused banner is a simulation** stored in the browser. It doesn't stop messages being processed.
- **Switching profile** only affects new orders; an existing order keeps the profile it was created with.

## More

- [`docs/EVAL_RESULTS.md`](docs/EVAL_RESULTS.md): how well the model does across the scenarios, what it costs, how fast it is.
- `docs/BRIEF.md`: the build brief (the single source of truth for behaviour), `docs/SCHEMA.sql`: the database.
