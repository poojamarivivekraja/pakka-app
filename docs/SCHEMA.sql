-- Already applied to Supabase. Reference only; do not run again.
-- Pakka database setup

create table settings (
  id int primary key default 1,
  active_profile text not null default 'bakery',
  business_name text not null default 'Kavya''s Bakes'
);
insert into settings (id) values (1);

create table customers (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique not null,
  name text,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text unique,
  customer_id uuid references customers(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  type text not null check (type in ('text','image','edit','revoke','unsupported')),
  body text,
  media_path text,
  sent_at timestamptz not null,
  status text not null default 'received'
    check (status in ('received','processed','failed','edited','revoked')),
  raw jsonb,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  profile text not null,
  status text not null default 'needs_review'
    check (status in ('needs_review','ready','confirmed','delivered','cancelled')),
  fields jsonb not null default '{}',
  updated_after_confirmation boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmed_at timestamptz
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  field text,
  old_value text,
  new_value text,
  actor text not null check (actor in ('chat','owner','system')),
  note text,
  source_message_id uuid references messages(id) on delete set null,
  created_at timestamptz default now()
);

create table update_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  text text not null,
  source_message_id uuid references messages(id) on delete set null,
  seen boolean not null default false,
  created_at timestamptz default now()
);

create table pending_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  field text not null,
  requested_value text not null,
  source_message_id uuid references messages(id) on delete set null,
  resolved text check (resolved in ('agreed','refused')),
  created_at timestamptz default now()
);

create table flags (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  type text not null check (type in (
    'missing_field','conflict','low_confidence','which_order',
    'payment_mismatch','message_deleted','message_unreadable')),
  detail text not null,
  data jsonb,
  resolved boolean not null default false,
  created_at timestamptz default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  kind text not null check (kind in ('reference_image','payment_screenshot')),
  description text,
  extracted jsonb,
  marked_received boolean not null default false,
  created_at timestamptz default now()
);

create table llm_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete set null,
  provider text,
  model text,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  ok boolean,
  error text,
  created_at timestamptz default now()
);

alter table settings enable row level security;
alter table customers enable row level security;
alter table messages enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table update_notes enable row level security;
alter table pending_requests enable row level security;
alter table flags enable row level security;
alter table attachments enable row level security;
alter table llm_calls enable row level security;