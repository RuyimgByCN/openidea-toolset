export function IconToolbox() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="12" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 4.5V3.4A1.1 1.1 0 0 1 6.6 2.3h2.8a1.1 1.1 0 0 1 1.1 1.1v1.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.2 8.2h11.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconStar({ filled }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M8 1.6l1.95 4 4.4.64-3.18 3.1.75 4.38L8 11.65l-3.92 2.07.75-4.38-3.18-3.1 4.4-.64L8 1.6z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSidebar() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function IconGlobe() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.25" />
      <ellipse cx="8" cy="8" rx="2.5" ry="5.6" stroke="currentColor" strokeWidth="1.15" />
      <path d="M2.6 8h10.8" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

export function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.12s ease" }}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlus() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
