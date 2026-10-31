-- Country of the business (ISO 3166-1 alpha-2), for businesses outside the Netherlands.
--
-- Picks the scan language and the AI systems' user location (core/shared/country.ts),
-- how phone numbers are read, the facts page's addressCountry and language, and whether
-- the Dutch directories are synced (only for NL). Every existing business is Dutch.
alter table business
  add column if not exists country text not null default 'NL'
    check (country ~ '^[A-Z]{2}$');
