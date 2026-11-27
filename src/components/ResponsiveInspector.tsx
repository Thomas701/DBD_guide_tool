import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Keep the desktop panel in its grid; use the browser's focus trap on phones.
export function ResponsiveInspector({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!mobile || !element) return;
    element.showModal();
    return () => element.close();
  }, [mobile]);
  if (!mobile) return children;
  return <dialog ref={dialog} className="mobile-inspector" aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}
