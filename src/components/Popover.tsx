import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../utils";

interface Props {
  /** The trigger's content. */
  trigger: ReactNode;
  /** Accessible name of the trigger. */
  label: string;
  /** Classes for the trigger button. */
  triggerClassName?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "left" | "right";
  panelClassName?: string;
  /** The panel; `close` dismisses it. */
  children: (close: () => void) => ReactNode;
}

/** A button that opens a small panel below it; outside click or Escape closes it. */
export function Popover({ trigger, label, triggerClassName, align = "left", panelClassName, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Consumed here, so multi-select behind the panel does not also exit.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-full z-40 mt-1 rounded-xl border border-border-subtle bg-surface p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
