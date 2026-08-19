import type { ReactNode } from 'react'

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    shield: <><path d="M12 3 4.5 6v5.4c0 4.8 3.2 7.9 7.5 9.6 4.3-1.7 7.5-4.8 7.5-9.6V6L12 3Z"/><path d="m9.3 12 1.8 1.8 3.8-4"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    download: <><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    trash: <><path d="M4 7h16M9 3h6l1 4H8zM7 7l1 14h8l1-14"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    report: <><path d="M7 3h10v18H7z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/></>,
    compare: <><path d="M7 5v14M17 5v14M3 9l4-4 4 4M13 15l4 4 4-4"/></>,
    rules: <><path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11"/></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 6.5 3.5 3.5"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v5l3 2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    swap: <><path d="M5 8h13l-3-3M19 16H6l3 3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
