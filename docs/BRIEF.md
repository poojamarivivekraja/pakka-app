# Pakka — Prototype Build Brief

This is the single source of truth for the build. Follow it exactly. Don't add features
that aren't listed. If something is unclear, ask before building.

## 1. Product

Pakka is an AI order copilot for small businesses that take custom orders on WhatsApp
Business (home bakers, jewellery makers, saree sellers, cloud kitchens' direct WhatsApp
orders). It reads order conversations and keeps a live order ticket per order: every
detail linked to its source message, a history of changes, and flags only for things
that genuinely need the owner. It NEVER sends messages to customers.

The prototype is demoed with a home bakery. Business profiles make it generic.

Out of scope: sending customer messages, aggregator orders (Swiggy, Zomato), voice notes,
Instagram, group chats, helper accounts, real push notifications, real payment
verification.

## 2. Architecture

- Next.js (App Router, TypeScript, Tailwind) deployed on Vercel.
- Supabase (Postgres + private storage bucket `media`). The database schema already
  exists (see section 4). All database access happens server-side with
  SUPABASE_SERVICE_ROLE_KEY. Never expose that key to the browser.
- AI: Google Gemini API (free tier), Flash model, JSON output. All model calls go through
  one adapter `src/lib/llm.ts`, using env vars LLM_PROVIDER and LLM_MODEL, so the provider
  can be switched by config. Handle 429 rate-limit errors with retry and backoff.
- Two input modes, one pipeline: a simulator (scripted conversations) and live WhatsApp
  webhooks. Both call the same `processMessage()`.
- Every route that triggers an AI call must check DEMO_PASSCODE (stored in a cookie after
  a passcode screen), so strangers can't use the AI quota.

Environment variables: GEMINI_API_KEY, LLM_PROVIDER, LLM_MODEL, NEXT_PUBLIC_SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSCODE. Later for live mode: WHATSAPP_TOKEN,
WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.

## 3. Business profiles

Config files in `src/config/profiles/`: `bakery.json` and `saree.json`. Each field has
`key`, `label`, `type` (text | exact_text | measurement | money | date | time | enum | items)
and `required` (true/false; address is required only when fulfilment is delivery or
courier). The active profile is stored in the `settings` table.

Universal fields (every profile):
- occasion (text, optional)
- items_summary (text, required)
- due_date (date, required)
- due_time (time, required)
- fulfilment (enum: pickup | delivery | courier, required)
- address (text, required if delivery or courier)
- tracking_number (text, optional)
- price_agreed (money, required)

Bakery adds: size_or_weight (required), flavour (required), dietary, design_notes,
personalisation (exact_text, label "Message on cake").

Saree adds: fabric, colour, quantity (required), blouse_measurements (measurement),
fall_and_pico, personalisation (exact_text, label "Embroidery").

Each value stored in `orders.fields` looks like:
{ "value": "...", "source_message_id": "...", "confidence": "high|low",
  "updated_at": "...", "previous_value": "... or null", "edited_by_owner": false }

## 4. Database (already created)

Tables: settings, customers, messages, orders, order_events (history), update_notes,
pending_requests, flags, attachments, llm_calls.

- orders.status: needs_review | ready | confirmed | delivered | cancelled
- flags.type: missing_field | conflict | low_confidence | which_order | payment_mismatch |
  message_deleted | message_unreadable
- order_events.actor: chat | owner | system
- pending_requests.resolved: null (open) | agreed | refused
- attachments.kind: reference_image | payment_screenshot; marked_received is set only by
  the owner

## 5. Extraction prompt (system prompt for the model)

```
You are an order-tracking assistant for a small business that takes custom orders on
WhatsApp. You read ONE new message at a time, plus context, and report what it means for
the business's orders. You never write replies to customers. You output JSON only.

CONTEXT YOU RECEIVE
- business_name, today's date, the new message's timestamp
- sender: "customer" or "business"
- the business profile's field list (keys, labels, types)
- the customer's open orders: id and current field values
- open pending requests for those orders: id, order id, field, requested value
- the last 15 messages in this chat, oldest first, each with id and sender
- for images: the image and any caption

YOUR TASKS
1. Classify: new_order | order_detail | change | payment | agreement | refusal |
   delivery_coordination | small_talk | other
2. Link to an order: an existing order id, "NEW" for a separate new order, or "NONE".
   If the customer has more than one open order and it's unclear which one, set
   link_confidence "low" and list candidate_order_ids.
3. Extract field updates using ONLY the profile's field keys.
4. If a business message agrees to or refuses an open pending request, list its id in
   agrees_to_pending or refuses_pending.
5. For images, decide image_role: reference_image | payment_screenshot | other.
   reference_image: one short sentence describing the design.
   payment_screenshot: read amount, reference, payee and date exactly as shown.

STRICT RULES
- Extract only what this message states. Never guess, infer unstated details, or use
  general knowledge.
- Every text-based field update must include "quote": the exact words from this message
  that support it. If you cannot quote it, do not extract it.
- agreed_by_business is true when the sender is "business", or when the value is a
  customer request the business already agreed to in an earlier message.
- If two incompatible values appear with no clear change (e.g. customer says "you said
  1600 na" after the business said 1800), do NOT pick one; return a conflict.
- Money: copy numbers exactly as written. Never calculate totals, balances or discounts.
- Dates: resolve relative dates against the message timestamp, output ISO format, keep
  the original words in "quote", and set confidence "low" if ambiguous.
- exact_text fields: copy spelling exactly, including the customer's own spelling.
- A payment screenshot is never proof of payment. Report what it shows; never say "paid".
- Messages may be English, Hinglish or mixed, with typos. If unsure, set confidence "low".

OUTPUT (JSON only)
{
  "message_type": "...",
  "order_ref": "<order id> | NEW | NONE",
  "link_confidence": "high | low",
  "candidate_order_ids": [],
  "field_updates": [
    { "field": "...", "value": "...", "quote": "...",
      "agreed_by_business": false, "confidence": "high | low" }
  ],
  "agrees_to_pending": [],
  "refuses_pending": [],
  "conflicts": [ { "field": "...", "values": ["...", "..."], "detail": "..." } ],
  "image_role": "reference_image | payment_screenshot | other | null",
  "image_description": null,
  "payment": null
}
```

## 6. Pipeline rules (in code, after the model responds)

1. Quote check: for text messages, each quote must appear in the message body
   (case-insensitive, whitespace-normalised). If not, drop the update and add a
   low_confidence flag.
2. order_ref "NEW": create an order with the active profile. Low link_confidence: create a
   which_order flag with candidate ids in `data`; apply nothing until the owner picks.
3. Field update where the field is EMPTY: apply it (store value, source, confidence).
4. Field update where the field already has a DIFFERENT value:
   - agreed_by_business true: apply it, keep previous_value, write order_events
     (actor chat), and create an update_note ("Flavour is now red velvet. Agreed in chat
     by your business on <date, time>.").
   - agreed_by_business false: create a pending_request; keep the current value.
5. agrees_to_pending: apply each pending value as in rule 4 (agreed) and set
   resolved = 'agreed'. refuses_pending: set resolved = 'refused', keep the current value.
6. Conflicts: create a conflict flag; change nothing.
7. Low-confidence updates: apply, but also add a low_confidence flag so the owner checks.
8. Payment screenshot: create an attachment (kind payment_screenshot, extracted
   amount/reference/payee/date, marked_received false). If the business asked for a
   specific advance and the amount differs, create a payment_mismatch flag. An
   unverified payment is NOT a flag; it shows in the Payments section with a
   "Mark as received" button.
9. Reference image: create an attachment with the description.
10. Edit event: reprocess the edited text and add an update_note ("Customer edited a
    message"). Revoke event: add a message_deleted flag and set confidence "low" on
    fields sourced from that message. Unsupported event (WhatsApp error 131060): add a
    message_unreadable flag ("1 message couldn't be read. Check WhatsApp.").
11. Missing fields: after every update, recompute missing required fields. Keep exactly
    one open missing_field flag per missing field; resolve it when the field is filled.
12. Balance = price_agreed − sum of payment screenshot amounts. Always computed in code.
13. Status (unless confirmed, delivered or cancelled): any open flag → needs_review;
    otherwise all required fields present → ready.
14. Confirmed orders stay confirmed when an agreed change arrives; set
    updated_after_confirmation = true until the owner views the order.
15. Log every model call in llm_calls (provider, model, tokens, latency, ok, error).

## 7. Test scenarios (synthetic data only)

Store as JSON in `src/data/scenarios/s1.json` … `s7.json`. Each message has: timestamp,
sender ("customer" | "business"), and text or image (path in public/samples/) or event
("edit" with new text, "revoke"). Each scenario has an `expected` block used by the
scenario runner to print PASS or FAIL per check. Year for all dates: 2026.

S1 Clean order (customer Priya, +91 99000 00001)
- [Mon 19 Oct 10:02] C: Hi! Saw your page on insta. Do you make theme cakes?
- [10:15] B: Hi Priya! Yes we do 😊 What's the occasion and date?
- [10:17] C: My son's 5th birthday, Saturday 24th. Want a jungle theme
- [10:18] C: [image: reference_jungle.jpg]
- [10:25] B: Lovely! For 1 kg chocolate truffle with this design it's ₹1400
- [10:30] C: Ok done. Write "Happy 5th Birthday Aarav" on it
- [10:31] C: Pickup at 5 pm is fine?
- [10:40] B: Perfect. Please send ₹700 advance to confirm
- [11:02] C: [image: payment_700.png]
Expected: one order; all required fields filled; reference image attached; payment
attachment ₹700 unverified; no flags; status ready; personalisation exactly
"Happy 5th Birthday Aarav"; balance ₹700.

S2 Change agreed in chat (customer Rahul, +91 99000 00002)
- [Tue 20 Oct 18:10] C: Need a cake for our anniversary on 31st
- [18:22] B: Congrats! Which flavour and size?
- [18:25] C: Chocolate, 1.5 kg. Delivery to Anna Nagar at 7 pm
- [18:30] B: Done, ₹1800. Message on cake?
- [18:32] C: "Happy Anniversery Meera"
- [Thu 22 Oct 09:05] C: Hey small change, make it red velvet instead. And eggless please, her mom is joining
- [09:20] B: Ok red velvet eggless done, no extra charge
Expected: after 09:05, flavour is still chocolate with a pending request for red velvet,
and dietary eggless applied (it was empty); after 09:20, flavour is red velvet,
previous_value chocolate, an update_note exists, the pending request is resolved
'agreed', and there is no flag for the change. Personalisation keeps the spelling
"Anniversery". Address "Anna Nagar" is stored.

S3 Edited message (customer Farah, +91 99000 00003)
- [Wed 21 Oct 14:00] C: Hi, 2 kg butterscotch cake for office farewell, Friday 30th, delivery 4 pm
- [14:03] event edit of the 14:00 message, new text: "Hi, 1.5 kg butterscotch cake for office farewell, Friday 30th, delivery 4 pm"
Expected: size 1.5 kg; an update_note about the edit; missing_field flags for
price_agreed and address; status needs_review.

S4 Two orders from one customer (customer Sneha, +91 99000 00004)
- [Thu 22 Oct 11:00] C: Hi! Birthday cake for my daughter on 29th, 1 kg vanilla with pink frosting
- [11:10] B: Sure, ₹1200. Pickup or delivery?
- [11:12] C: Pickup, around 6
- [11:30] C: Also, separate order: 12 cupcakes for my office on 2nd Nov, assorted flavours
- [11:45] B: Cupcakes are ₹60 each, so ₹720
- [Fri 23 Oct 09:00] C: For the cupcakes can you add "Team Alpha" toppers?
Expected: two orders; the birthday order is ready (due 29 Oct, 6 pm, pickup, ₹1200);
the cupcake order has "Team Alpha" in design_notes or personalisation, ₹720, and
missing_field flags for due_time and fulfilment.

S5 Conflict and gaps (customer Karthik, +91 99000 00005)
- [Fri 23 Oct 16:00] C: Need 2 kg black forest for my dad's 60th, Sunday 1st Nov
- [16:20] B: That'll be ₹1800 with the gold topper
- [Sat 24 Oct 10:00] C: Ok. Delivery to Velachery
- [10:05] C: Btw you said 1600 na?
Expected: a conflict flag on price_agreed (1800 vs 1600) with price unchanged at 1800;
a missing_field flag for due_time; status needs_review.

S6 Payment mismatch (continues S2, customer Rahul; run after S2)
- [Thu 22 Oct 09:25] B: Please send ₹900 advance
- [09:40] C: [image: payment_500.png]
- [09:41] C: sent!
Expected: a payment attachment ₹500 unverified; a payment_mismatch flag (₹500 vs ₹900);
balance ₹1,300; status needs_review.

S7 Small talk (continues S1, customer Priya; run after S1)
- [Sun 25 Oct 20:00] C: Thank you so much! Cake was super yummy, Aarav loved it 😍
Expected: message_type small_talk; no field changes, flags or notes.

Sample images in public/samples/: reference_jungle.jpg and reference_floral.jpg (free
photos from Unsplash; note sources in README), payment_700.png and payment_500.png
(mock UPI success screens generated by script, payee "Kavya's Bakes", fake reference
numbers, large diagonal "SAMPLE" watermark).

## 8. UI

Font: Inter. Mobile-first, max width about 420px, centred on desktop. All colours in one
theme file.

Colours:
- Background #FAF8F5, surface #FFFFFF, border #E9E4DD, text #26221E,
  secondary text #6F675F, date block #F3EFE9.
- Primary #B5562E, used ONLY for the wordmark, the "Next up" marker, one primary button
  per screen, links ("Source ↗") and focus states.
- Status pills (soft background with dark text, never large filled areas):
  Confirmed #E7F1EA / #2E6B47 · Updated from chat #E9EFF7 / #33598A ·
  Needs review #FBEFD9 / #8A5A0B · Ready to confirm #F1EEEA / #5E5750.
- Selected filter: dark ink #26221E with white text.

Screens:
1. Orders (`/`): header with "Pakka" wordmark, sync status and today's date; three counts
   (open, needs review, due this week); filters All / Needs review / Ready / Confirmed;
   orders grouped by week with date ranges ("This week · 19–25 Oct"); each card has a
   neutral date block (day, large date, month), the time in bold with fulfilment,
   customer · occasion, item summary, a status pill, and a one-line issue summary in the
   review colour. "Next up" label in primary on the soonest upcoming order. A missing
   time shows "Time missing" in the review colour. Bottom nav: Orders, Chats, Settings.
2. Order (`/orders/[id]`): header with date block, time and fulfilment, customer ·
   occasion, status pill. Then: "Updated from chat" notes with "Got it" (marks seen);
   pending requests shown as "Requested: <value>, waiting for your reply" with
   "Reply in WhatsApp"; "Needs review" items with actions (View screenshot,
   Ask in WhatsApp, Add <field>, Which order? choose); order details from the active
   profile, each with "Source ↗" and "Was <value>" for changed values; personalisation
   shown exactly as written with the note "Spelling kept exactly as the customer wrote
   it"; Payments (price agreed, advance asked, screenshot amounts "· not verified" with
   "Mark as received", balance with "Calculated by the app, not read from chat");
   History; Confirm order button, disabled with the reason while required fields are
   missing, plus the note "Built from synced messages; check the chat if something looks
   missing." The owner can edit any field; edits are marked "Edited by you".
3. Source sheet: bottom sheet titled 'Source for "<Field>: <value>"', showing the source
   messages as chat bubbles with the supporting words highlighted, "Agreed in chat by
   your business at <time>" when relevant, and "Open in WhatsApp" / "Close".
4. Chats (`/chats`): list of customers; each opens a read-only chat view.
5. Your business (`/settings`): profile options (Home bakery, Sarees and clothing,
   Jewellery, Food orders on WhatsApp) with the note "Orders from Swiggy, Zomato and
   other apps aren't covered. Pakka tracks orders you take directly on WhatsApp."; the
   tracked fields for the active profile with neutral "Required" / "Optional" labels;
   the WhatsApp connection card ("Pakka only reads your business chats to keep orders up
   to date. It never sends messages to your customers.").
6. Mock notification: when processing creates a new Needs review item, show an in-app
   toast like