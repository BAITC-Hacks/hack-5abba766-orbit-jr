"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerStartedOutside = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const previousOverflow = document.documentElement.style.overflow;
    dialog?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.documentElement.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
      else {
        const fallback =
          document.querySelector<HTMLElement>("main button:not([disabled])") ??
          document.querySelector<HTMLElement>("main[tabindex]");
        fallback?.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerStartedOutside.current = event.target === event.currentTarget && (
          event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom
        );
      }}
      onClick={(e) => {
        const startedOutside = pointerStartedOutside.current;
        pointerStartedOutside.current = false;
        if (!startedOutside || e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < bounds.left || e.clientX > bounds.right ||
          e.clientY < bounds.top || e.clientY > bounds.bottom
        ) close();
      }}
    >
      <button type="button" className="close" aria-label="Закрыть окно" onClick={close}>
        <X aria-hidden="true" />
      </button>
      <div className="modal-content">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
