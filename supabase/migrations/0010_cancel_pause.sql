-- Cancel and pause, by the owner (apps/web/app/app/abonnement, core/billing/lifecycle.ts).
--
-- cancel_at: the owner cancelled; the subscription ends at this moment (the end
--   of the paid period, cancel_at_period_end at Stripe). Cleared when they
--   change their mind before it. The status stays trial/active until Stripe
--   ends the subscription (customer.subscription.deleted → churned).
-- pause_until: the owner paused; no checks, fixes, syncs or charges until this
--   moment (pause_collection at Stripe with resumes_at). Different from status
--   'paused', which means a payment failed.
alter table business
  add column if not exists cancel_at timestamptz,
  add column if not exists pause_until timestamptz;
