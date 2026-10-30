"use client";

/** Opens the browser's print dialog; "Save as PDF" is one of its printers. The print stylesheet is in globals.css. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-link self-start print:hidden">
      {label}
    </button>
  );
}
