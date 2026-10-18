"use client";

import { useEffect, useRef, useState } from "react";
import type { CopyShape } from "@vidalo/core/copy";
import type { Lang } from "@/lib/lang-paths";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * The website assistant: a button at the bottom right, a panel with the
 * conversation. It says it is an AI at first contact and names the mailbox
 * as the human channel (LEGAL-NL §7). The conversation lives in this tab's
 * memory only: no cookie, no storage, nothing sent anywhere but /api/chat.
 */
export function ChatWidget({ copy, lang }: { copy: CopyShape["chat"]; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user" as const, content }].slice(-12);
    setMessages(next);
    setInput("");
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next, lang }) });
      const data = (await res.json()) as { reply?: string; provider?: string };
      const reply = data.reply ?? copy.error;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (data.provider === "faq") setNote(copy.faqNote);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: copy.error }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="vidalo-chat"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-16 right-4 z-40 rounded-pill border-[1.5px] border-ink bg-white px-4 py-2.5 text-[14px] font-semibold shadow-[0_4px_16px_rgba(16,18,24,0.10)] hover:border-blue hover:text-blue sm:bottom-6 sm:right-6"
      >
        {open ? copy.close : copy.button}
      </button>
      {open && (
        <section id="vidalo-chat" aria-label={copy.title} className="fixed bottom-28 right-4 z-40 flex max-h-[70vh] w-[min(380px,calc(100vw-2rem))] flex-col rounded-2xl border-[1.5px] border-line bg-white shadow-[0_8px_32px_rgba(16,18,24,0.14)] sm:bottom-20 sm:right-6">
          <header className="border-b-[1.5px] border-line px-4 py-3">
            <p className="text-[15px] font-bold">{copy.title}</p>
            <p className="mt-0.5 text-[12px] leading-[1.4] text-muted">
              {copy.aiNotice}{" "}
              <a href="mailto:hello@vidalo.io" className="underline underline-offset-2">
                hello@vidalo.io
              </a>
            </p>
          </header>
          <div ref={listRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[14px] leading-[1.5]">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-ink-2">{copy.welcome}</p>
                <div className="flex flex-wrap gap-2">
                  {copy.starters.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-pill border-[1.5px] border-line px-3 py-1.5 text-[13px] hover:border-blue hover:text-blue">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <p key={i} className={m.role === "user" ? "ml-8 rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-white" : "mr-8 rounded-2xl rounded-bl-md bg-panel px-3.5 py-2 text-ink"}>
                {m.content}
              </p>
            ))}
            {busy && <p className="mr-8 text-muted">{copy.thinking}</p>}
            {note && <p className="text-[12px] text-muted">{note}</p>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t-[1.5px] border-line p-3"
          >
            <label htmlFor="vidalo-chat-input" className="sr-only">
              {copy.placeholder}
            </label>
            <input id="vidalo-chat-input" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} maxLength={600} placeholder={copy.placeholder} autoComplete="off" className="field h-[44px] flex-1 text-[14px]" />
            <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-[44px] px-4 text-[14px] disabled:opacity-50">
              {copy.send}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
