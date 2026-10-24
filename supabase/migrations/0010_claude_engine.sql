-- Claude joins the monthly check as the sixth AI system (decided 24 Oct 2026).
-- The engine enum gains a value; existing rows are untouched.
alter type engine add value if not exists 'claude';
