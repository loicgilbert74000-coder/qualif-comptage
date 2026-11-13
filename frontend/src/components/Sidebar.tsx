import { NavLink } from "react-router-dom";
import clsx from "clsx";

const NAV_ITEMS = [
  { to: "/", label: "Qualification des données", icon: IconChart },
  { to: "/traitements", label: "Traitements & reconstructions", icon: IconLayers },
  { to: "/historique", label: "Historique des traitements", icon: IconClock },
  { to: "/batiments", label: "Bâtiments & compteurs", icon: IconBuilding },
  { to: "/parametres", label: "Paramètres", icon: IconGear },
];

export default function Sidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-5">
        <GenevaCrest />
        <div className="leading-tight">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-geneva-900">
            République
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-geneva-900">
            et Canton de Genève
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-geneva-50 text-geneva-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-100 px-3 py-4">
        <a
          href="#"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900"
        >
          <IconHelp className="h-5 w-5 shrink-0" />
          <span>Aide & support</span>
        </a>
      </div>
    </aside>
  );
}

function GenevaCrest() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
      <path d="M24 4 L40 12 V24 C40 34 33 41 24 44 C15 41 8 34 8 24 V12 Z" fill="#fde047" stroke="#0f2a4a" strokeWidth="1.5" />
      <path d="M24 4 L40 12 V24 C40 34 33 41 24 44 Z" fill="#1d4b7c" opacity="0.15" />
      <path d="M14 22 h20 M24 14 v16" stroke="#0f2a4a" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function IconChart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 19V5M4 19h16M8 15v-4M12 15V8m4 7v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLayers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3l9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3 13l9 5 9-5M3 17l9 5 9-5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconClock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconBuilding({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="4" y="3" width="11" height="18" stroke="currentColor" strokeWidth="1.8" />
      <rect x="15" y="9" width="5" height="12" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 7h2M11 7h0M7 11h2M11 11h0M7 15h2M11 15h0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconGear({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4.6a7.7 7.7 0 0 0-1.7-1l-.4-2.4h-4l-.4 2.4a7.7 7.7 0 0 0-1.7 1l-2.4-.6-2 3.5 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-.6a7.7 7.7 0 0 0 1.7 1l.4 2.4h4l.4-2.4a7.7 7.7 0 0 0 1.7-1l2.4.6 2-3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconHelp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.3c-.9.5-1.1.9-1.1 1.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" />
    </svg>
  );
}
