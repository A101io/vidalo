-- Domain registration, the paid add-on (option B on /app/domein, docs/DOMAINS.md).
--
-- One domain per business, as one jsonb document (core/registrar/types.ts,
-- DomainRegistration): the name, where it stands (checkout, paid, registered,
-- failed, ended), the holder's details sent to the registrar, the registrar's
-- ids, the add-on's own yearly Stripe subscription, expiry and auto-renew.
-- Null = never asked. The holder is the owner's business; Vidalo is only the
-- reseller and technical contact. Deleted with the business (art. 17).
alter table business add column if not exists domain_registration jsonb;
