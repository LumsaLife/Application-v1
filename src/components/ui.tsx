/**
 * Small shared primitives.
 *
 * Deliberately a single file of plain components rather than a component
 * library — this is an MVP, and four exports do not need four directories.
 */

import * as React from "react";

function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gold text-canvas hover:bg-gold-bright active:scale-[0.985] shadow-sm",
  secondary:
    "bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-raised",
  ghost: "text-muted hover:text-text hover:bg-surface-raised",
  danger: "text-danger border border-danger/30 hover:bg-danger/8",
};

export function Button({
  variant = "primary",
  className,
  loading = false,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5",
        "text-sm font-medium transition-all duration-200",
        "disabled:pointer-events-none disabled:opacity-45",
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const FIELD_BASE =
  "w-full rounded-xl border border-border bg-surface px-4 py-3 text-[15px] text-text " +
  "placeholder:text-faint transition-colors duration-200 " +
  "hover:border-border-strong focus:border-gold focus:outline-none " +
  "focus:ring-2 focus:ring-gold/25";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD_BASE, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cx(FIELD_BASE, "resize-none", className)} {...props} />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm font-medium text-text">{label}</span>
      {hint && (
        <span className="block text-[13px] leading-relaxed text-muted">
          {hint}
        </span>
      )}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-border bg-surface p-6",
        "shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A selectable option card. Used for tone and length pickers, where radio
 * buttons would be both ugly and hard to tap on a phone.
 */
export function OptionCard({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "w-full rounded-xl border px-4 py-3 text-left transition-all duration-200",
        selected
          ? "border-gold bg-gold-soft"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised",
      )}
    >
      <span
        className={cx(
          "block text-sm font-medium",
          selected ? "text-gold" : "text-text",
        )}
      >
        {title}
      </span>
      {description && (
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">
          {description}
        </span>
      )}
    </button>
  );
}

/** Inline error / notice strip. */
export function Notice({
  tone = "error",
  children,
}: {
  tone?: "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cx(
        "rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed",
        tone === "error"
          ? "bg-danger/8 text-danger"
          : "bg-gold-soft text-muted",
      )}
    >
      {children}
    </p>
  );
}
