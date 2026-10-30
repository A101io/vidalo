#!/usr/bin/env bash
# Verify the mail DNS for vidalo.io. Companion to docs/mail.md. Read-only.
# DNS caches: if a record you just added is missing, wait 15 minutes and re-run.
d="${1:-vidalo.io}"
pass=0; fail=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }
note() { printf "    %s\n" "$1"; }

echo "══════════ $d ══════════"

mx=$(dig +short MX "$d")
if [ -z "$mx" ]; then bad "MX missing (mail to @$d bounces)"
elif echo "$mx" | grep -qiE 'smtp\.google\.com|aspmx\.l\.google\.com'; then ok "MX points at Google"; note "$(echo "$mx" | tr '\n' ' ')"
else bad "MX present but not Google"; note "$mx"; fi

spf=$(dig +short TXT "$d" | grep -i 'v=spf1')
if [ -z "$spf" ]; then bad "SPF missing"
elif echo "$spf" | grep -qi 'amazonses'; then bad "SPF includes amazonses on the root (belongs on send.$d)"; note "$spf"
elif echo "$spf" | grep -qi '_spf.google.com'; then ok "SPF includes Google"; note "$(echo "$spf" | tr -d '"')"
else bad "SPF present but does not include Google"; note "$spf"; fi

dmarc=$(dig +short TXT "_dmarc.$d")
if [ -z "$dmarc" ]; then bad "DMARC missing"
elif echo "$dmarc" | grep -qi 'rua=mailto:julian@'; then ok "DMARC reporting to julian@"; note "$(echo "$dmarc" | tr -d '"')"
elif echo "$dmarc" | grep -qi 'rua=mailto:'; then bad "DMARC rua is not julian@$d: an address on another domain gets no reports unless that domain publishes $d._report._dmarc (docs/mail.md)"; note "$dmarc"
else bad "DMARC has no rua, so no reports arrive"; note "$dmarc"; fi

if [ -n "$(dig +short TXT "google._domainkey.$d")" ]; then ok "Google DKIM record present"
else bad "Google DKIM (google._domainkey) missing"; fi

if [ -n "$(dig +short TXT "$d" | grep -i google-site-verification)" ]; then ok "Workspace site-verification present"
else bad "google-site-verification TXT missing (Workspace cannot verify the domain)"; fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
