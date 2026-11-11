import type { FactKey, Finding } from "@vidalo/core/types";
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_LABEL, NOT_FOUND_VALUE, PRESENT_VALUE } from "@vidalo/core/types";
import { displayAddress, formatPhone } from "@vidalo/core/scanner";
import type { CopyShape } from "@vidalo/core/copy";

function dayName(subject: string | null, copy: CopyShape): string | null {
  return subject != null && /^\d$/.test(subject) ? (copy.report.days[Number(subject)] ?? null) : null;
}

/** The question a customer would ask for a given fact, in the page's language; the "Vraag" line on cards. */
export function questionFor(factKey: FactKey, subject: string | null, name: string, place: string, copy: CopyShape, online = false): string {
  const q = copy.report.question;
  // An online business has no town in its questions (feature 001); the name alone is the subject.
  const who = online ? name : `${name} in ${place}`;
  switch (factKey) {
    case "existence":
      return q.existence(who);
    case "hours": {
      const day = dayName(subject, copy);
      return day ? q.hoursDay(who, day) : q.hours(who);
    }
    case "phone":
      return q.phone(who);
    case "address":
      return q.address(who);
    case "website":
      return q.website(who);
    case "service":
      return subject ? q.serviceSubject(who, subject) : q.service(who);
    case "price":
      return subject ? q.priceSubject(who, subject) : q.price(who);
    case "policy":
      return subject ? q.policySubject(who, subject) : q.policy(who);
    case "payment":
      return subject === "pin" || !subject ? q.payment(who) : q.paymentWith(who, subject);
    case "area":
      return subject ? q.areaSubject(who, subject) : q.area(who);
    case "urgency":
      return q.urgency(who);
    case "credential":
      return subject ? q.credentialSubject(who, subject) : q.credential(who);
    case "identity":
      if (subject === "kind") return q.identityKind(name);
      return subject ? q.identitySubject(who, subject) : q.identity(who);
  }
}

/** The recommendation question ("Welk bedrijf in Haarlem doet warmtepompen?") behind a not-named finding. */
export function recommendationQuestionFor(factKey: FactKey, subject: string | null, place: string, copy: CopyShape): string {
  const q = copy.recommendation.question;
  switch (factKey) {
    case "service":
      return subject ? q.service(subject, place) : q.other(place);
    case "area":
      return subject ? q.area(subject) : q.other(place);
    case "urgency":
      return q.urgency(place);
    case "hours": {
      const day = dayName(subject, copy);
      return day ? q.hours(day, place) : q.other(place);
    }
    case "credential":
      return subject ? q.credential(subject, place) : q.other(place);
    case "policy":
      return subject ? q.policy(subject, place) : q.other(place);
    case "existence":
      return subject && q.intent[subject] ? q.intent[subject]!(place) : q.other(place);
    default:
      return q.other(place);
  }
}

/**
 * A stored (normalised) value in words, in the page's language. The same
 * mapping as core's describeValue (Dutch, used by the CLI and e-mails); the
 * stored values themselves carry no language.
 */
export function humanValue(factKey: FactKey, value: string, subject: string | null, copy: CopyShape): string {
  const V = copy.report.value;
  if (!value.trim()) return V.unknown; // a finding without a fact (not found, another business)
  if (value === NOT_FOUND_LABEL || value === NOT_FOUND_VALUE) return V.notFound;
  if (value === ABSENT_VALUE || value === ABSENT_LABEL) return V.absent;
  if (value === PRESENT_VALUE) return V.present;
  switch (factKey) {
    case "existence":
      return value === "open" ? V.open : value === "temporarily_closed" ? V.temporarilyClosed : V.permanentlyClosed;
    case "hours": {
      const day = dayName(subject, copy) ?? "";
      if (value === "closed") return V.closed(day);
      const [from = value, to = ""] = value.split("-");
      return to ? V.range(day, from, to) : `${day} ${value}`.trim();
    }
    case "phone":
      return value.startsWith("+") ? formatPhone(value) : value;
    case "address":
      return displayAddress(value);
    case "service":
    case "policy":
    case "payment":
    case "area":
    case "urgency":
    case "credential":
      return value === "yes" ? V.yes : value === "no" ? V.no : value;
    case "identity":
      if (subject === "kind") return value === "other" ? V.otherKind : value === "same" ? V.sameKind : value;
      return value === "no" ? V.otherBusiness : value === "yes" ? V.sameBusiness : value;
    case "price":
      return `€ ${value.replace(".", ",")}`;
    default:
      return value;
  }
}

export function wrongText(f: Pick<Finding, "factKey" | "wrongValue" | "subject">, copy: CopyShape): string {
  return humanValue(f.factKey, f.wrongValue, f.subject, copy);
}
export function correctText(f: Pick<Finding, "factKey" | "correctValue" | "subject">, copy: CopyShape): string {
  return humanValue(f.factKey, f.correctValue, f.subject, copy);
}
