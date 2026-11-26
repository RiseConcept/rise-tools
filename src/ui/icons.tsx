// Ícones de traço (1,75 px, currentColor), conforme o brand guide §07.
import type { ReactNode } from "react";

type P = { className?: string };
const make = (children: ReactNode) => ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
       strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
    {children}
  </svg>
);

export const IconHome = make(<><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></>);
export const IconClip = make(<><rect x="3" y="5" width="18" height="14" /><path d="M3 9h18M7 5v4M11 5v4M15 5v4M19 5v4" /><path d="m10 12 5 2.5-5 2.5z" /></>);
export const IconFile = make(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>);
export const IconFolder = make(<path d="M3 6h7l2 2h9v11H3z" />);
export const IconUpload = make(<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v5h16v-5" /></>);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCheck = make(<path d="m5 12 5 5 9-10" />);
export const IconAlert = make(<><path d="M12 3 2 21h20z" /><path d="M12 10v5M12 17.5v.5" /></>);
export const IconInfo = make(<><rect x="3" y="3" width="18" height="18" /><path d="M12 11v6M12 7.5v.5" /></>);
export const IconArrowRight = make(<path d="M4 12h16m-5-5 5 5-5 5" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>);
export const IconUndo = make(<><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-3" /></>);
export const IconEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>);
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" /><path d="M16 8V4H4v12h4" /></>);
export const IconConsole = make(<><rect x="3" y="4" width="18" height="16" /><path d="m7 9 3 3-3 3M12 15h5" /></>);
export const IconTrash = make(<><path d="M4 7h16M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>);
export const IconGauge = make(<><path d="M3 17a9 9 0 1 1 18 0" /><path d="m12 17 4-6" /><path d="M3 21h18" /></>);
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>);
export const IconChevron = make(<path d="m9 6 6 6-6 6" />);
export const IconRename = make(<><path d="M3 7h12M3 12h8M3 17h6" /><path d="M14 20l1-4 5-5 3 3-5 5z" /></>);
export const IconReveal = make(<><path d="M3 6h7l2 2h9v11H3z" /><path d="M12 11v5m-2.5-2.5L12 16l2.5-2.5" /></>);

export function Spinner({ className = "size-10" }: P) {
  return (
    <svg viewBox="25 25 50 50" className={`${className} animate-rotate`} aria-hidden>
      <circle cx="50" cy="50" r="20" fill="none" stroke="rgb(var(--main))" strokeWidth="4" className="animate-dash" />
    </svg>
  );
}

/** Símbolo da montanha (brand guide §02), na cor do tema. */
export function Mountain({ className = "", shade = true }: P & { shade?: boolean }) {
  return (
    <svg viewBox="572 190 966 294" className={className} aria-hidden>
      <path fill="rgb(var(--main))" d="M572 484 L821 318 L890 342 L1097 190 L1309 361 L1374 355 L1538 484 Z" />
      {shade && (
        <path fill="rgb(var(--mainHover))"
              d="M740 450 L834 373 L858 393 L824 430 L821 415 Z M992 397 L1126 290 L1109 246 L1308 413 L1202 359 L1187 402 L1141 339 Z M1332 392 L1371 387 L1425 444 L1386 424 L1388 445 Z" />
      )}
    </svg>
  );
}
