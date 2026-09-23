"use client";
import { useEffect, useRef } from "react";
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
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
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
      aria-label={title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <button className="close" aria-label="Закрыть окно" onClick={close}>
        <X />
      </button>
      <div className="modal-content">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
