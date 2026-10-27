import { useEffect, type ReactNode } from "react";

/** A full-screen menu over the game. Closes on Escape or a click on the backdrop. */
export function Modal({ title, icon, onClose, children, wide }: { title: string; icon: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <span className="modal-icon" aria-hidden>{icon}</span>
          <h2>{title}</h2>
          <button className="close" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
