"use client";

import { useRef, type ReactNode } from "react";

/**
 * A button whose action is gated behind a confirmation dialog.
 *
 * Uses the native <dialog> element deliberately: showModal() gives focus
 * trapping, Esc-to-close, inertness of the page behind it and a ::backdrop for
 * free — all things a hand-rolled div would have to reimplement badly.
 *
 * Used for admin actions that were previously one click from irreversible:
 * removing a player, demoting an admin, regenerating the invite code (which
 * silently invalidates a code that may already have been shared), and
 * re-windowing the standings everyone sees.
 */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel,
  onConfirm,
  className = "btn-ghost",
  buttonTitle,
  disabled,
  danger,
}: {
  label: ReactNode;
  /** Heading of the dialog — phrase it as the question being asked. */
  title: string;
  /** What actually happens, including what is NOT lost. */
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  buttonTitle?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        title={buttonTitle}
        disabled={disabled}
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        className="confirm-dialog"
        // Clicking the backdrop targets the dialog element itself.
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <h3 className="font-display text-xl uppercase tracking-wide">{title}</h3>
        <div className="mt-2 text-sm text-muted">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-amber"}
            onClick={() => {
              ref.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
