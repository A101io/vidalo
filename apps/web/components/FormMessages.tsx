"use client";

import { useEffect } from "react";

type Messages = { required: string; checkbox: string; email: string; url: string; number: string };

/**
 * The browser's own "fill in this field" bubbles speak the browser's
 * language, not the page's (a Dutch bubble on the English coming-soon page,
 * 23 Oct 2026). One listener for every form: when a field is invalid, the
 * bubble gets our message in the page's language. Renders nothing and
 * never touches markup; without script the browser's own text remains.
 */
export function FormMessages({ messages }: { messages: Messages }) {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
      el.setCustomValidity("");
      const v = el.validity;
      if (v.valid) return;
      const type = el instanceof HTMLInputElement ? el.type : "";
      el.setCustomValidity(
        v.valueMissing
          ? type === "checkbox"
            ? messages.checkbox
            : messages.required
          : v.typeMismatch && type === "email"
            ? messages.email
            : v.typeMismatch && type === "url"
              ? messages.url
              : type === "number"
                ? messages.number
                : messages.required,
      );
    };
    // A custom message makes the field invalid until it is cleared again.
    const onEdit = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, [messages]);
  return null;
}
