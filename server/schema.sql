-- ─────────────────────────────────────────────────────────────────────────────
-- FamilyCrate Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Families ──────────────────────────────────────────────────────────────────
create table if not exists families (
  id                    uuid primary key references auth.users(id) on delete cascade,
  family_name           text not null,
  owner_email           text not null,
  stripe_customer_id    text,
  stripe_subscription_id text,
  subscription_status   text default 'trialing', -- trialing | active | past_due | cancelled
  trial_ends_at         timestamptz,
  rate                  numeric default 0.25,
  period_start          date default current_date,
  period_days           integer default 14,
  spent_points          jsonb default '{}',
  created_at            timestamptz default now()
);

-- ── Members ───────────────────────────────────────────────────────────────────
create table if not exists members (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  name        text not null,
  color       text default '#3A6A88',
  photo_url   text,
  email       text,
  role        text default 'kid', -- admin | kid
  sort_order  integer default 0,
  created_at  timestamptz default now()
);

-- ── Items (chores, groceries, todos) ─────────────────────────────────────────
create table if not exists items (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  text        text not null,
  points      integer default 0,
  category    text default 'chores', -- chores | groceries | todos
  assigned_to uuid[] default '{}',   -- array of member ids
  repeat      text default 'none',   -- none | daily | weekly-dow | monthly
  start_date  date,
  date        date,
  time        text,
  duration    integer default 30,
  note        text,
  created_at  timestamptz default now()
);

-- ── Events ────────────────────────────────────────────────────────────────────
create table if not exists events (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  title       text not null,
  member_ids  uuid[] default '{}',
  time        text,
  duration    integer default 60,
  date        date,
  start_date  date,
  repeat      text default 'none',
  type        text default 'family', -- family | school | activity
  color       text,
  created_at  timestamptz default now()
);

-- ── Done log (checkmarks) ─────────────────────────────────────────────────────
create table if not exists done_log (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  key         text not null,  -- format: itemId__memberId__date
  done        boolean default true,
  created_at  timestamptz default now(),
  unique(family_id, key)
);

-- ── Rewards ───────────────────────────────────────────────────────────────────
create table if not exists rewards (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  title       text not null,
  points      integer not null,
  icon        text default '🎁',
  created_at  timestamptz default now()
);

-- ── Redeem requests ───────────────────────────────────────────────────────────
create table if not exists redeem_requests (
  id          uuid primary key default uuid_generate_v4(),
  family_id   uuid references families(id) on delete cascade,
  reward_id   uuid references rewards(id) on delete cascade,
  member_id   uuid references members(id) on delete cascade,
  points      integer not null,
  status      text default 'pending', -- pending | approved | declined
  created_at  timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Families can only see their own data
alter table families         enable row level security;
alter table members          enable row level security;
alter table items            enable row level security;
alter table events           enable row level security;
alter table done_log         enable row level security;
alter table rewards          enable row level security;
alter table redeem_requests  enable row level security;

-- Service role bypasses RLS (our server uses service key, so this is fine)
-- These policies allow authenticated users to read their own family data
create policy "family_owner" on families for all using (auth.uid() = id);
create policy "family_members" on members for all using (family_id = auth.uid());
create policy "family_items" on items for all using (family_id = auth.uid());
create policy "family_events" on events for all using (family_id = auth.uid());
create policy "family_done" on done_log for all using (family_id = auth.uid());
create policy "family_rewards" on rewards for all using (family_id = auth.uid());
create policy "family_redeem" on redeem_requests for all using (family_id = auth.uid());

-- ── Indexes for performance ───────────────────────────────────────────────────
create index if not exists idx_members_family on members(family_id);
create index if not exists idx_items_family on items(family_id);
create index if not exists idx_events_family on events(family_id);
create index if not exists idx_done_family on done_log(family_id);
create index if not exists idx_done_key on done_log(family_id, key);
create index if not exists idx_rewards_family on rewards(family_id);
create index if not exists idx_redeem_family on redeem_requests(family_id);
