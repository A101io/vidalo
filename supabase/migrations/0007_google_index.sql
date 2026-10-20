-- Google Search Console state per facts page. Vidalo verifies the facts host
-- (meta tag on the page it serves), adds it as a Search Console property,
-- submits the sitemap and inspects the page, so we know Google has read it
-- instead of hoping. One row per business; a new facts host resets the row.
-- Internal table: RLS on, no policies (service role / table owner only).
create table if not exists google_index (
  business_id uuid primary key references business(id) on delete cascade,
  host text not null,
  token text,
  verified_at timestamptz,
  added_at timestamptz,
  sitemap_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  inspection jsonb,
  indexed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table google_index enable row level security;
