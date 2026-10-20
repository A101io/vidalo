-- Recommendation intents and the rotating question bank (docs/CRITERIA.md).
-- Every sector asks one recommendation question per intent (kwaliteit,
-- vertrouwen, nu, specialisme, prijs, plek) on each full scan ("core"); a bank
-- of 20 to 30 more phrasings, places and seasons rotates in a few at a time.
-- A bank question where the business is mostly not named moves to the core.
alter table prompt add column if not exists intent text;
alter table prompt add column if not exists pool text not null default 'core';
alter table prompt add column if not exists season text;
create index if not exists prompt_business_pool_idx on prompt (business_id, pool) where active;
