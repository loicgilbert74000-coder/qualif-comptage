import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { useQualifAI } from "../context/QualifAIContext";

const NAV_ITEMS = [
  { to: "/", label: "Qualification des données", icon: IconChart },
  { to: "/traitements", label: "Traitement", icon: IconProcess },
  { to: "/historique", label: "Historique des traitements", icon: IconClock },
  { to: "/exports", label: "Gestion des exports", icon: IconDownload },
  { to: "/batiments", label: "Bâtiments & compteurs", icon: IconBuilding },
  { to: "/parametres", label: "Types d'erreurs", icon: IconSearch },
  { to: "/base-donnees", label: "Base de données", icon: IconDatabase },
];

export default function Sidebar() {
  const [version, setVersion] = useState<string | null>(null);
  const qualifAI = useQualifAI();

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setVersion(d.version ?? null))
      .catch(() => setVersion(null));
  }, []);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-sidebar text-slate-300">
      <div className="flex items-center px-5 py-5">
        <img
          src="/geneva-logo.png"
          alt="République et Canton de Genève"
          className="h-[52px] w-auto"
        />
      </div>

      <nav className="space-y-1 px-3 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-active text-white"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <section
        className="mx-3 mb-3 overflow-hidden rounded-xl border border-sky-400/20 bg-white/5 p-3"
        aria-label="Réglages Qualif IA"
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <IconSparkle className="h-4 w-4 shrink-0 text-sky-300" />
          <span className="min-w-0 flex-1 truncate">Qualif IA</span>
          <span className="shrink-0 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-medium text-sky-200">
            {qualifAI.enabled ? "Active" : "En pause"}
          </span>
        </div>
        <div className="space-y-2">
          <AISwitch label="Auto-apprentissage" checked={qualifAI.enabled} onChange={qualifAI.setEnabled} />
          <AISwitch
            label="Suggestions IA"
            checked={qualifAI.suggestionsEnabled}
            onChange={qualifAI.setSuggestionsEnabled}
            disabled={!qualifAI.enabled}
          />
        </div>
        <p className="mt-2 text-[10px] leading-4 text-slate-400">
          {qualifAI.learnedDecisionCount} décision(s) mémorisée(s) · stockage local à ce navigateur
        </p>
      </section>

      <div className="mt-auto">
        <img
          src="/geneva-skyline.png"
          alt=""
          aria-hidden
          className="h-28 w-full object-cover object-bottom opacity-90"
        />
        <div className="px-3 pb-5 pt-3">
          <a
            href="#"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <IconHelp className="h-5 w-5 shrink-0" />
            <span>Aide & support</span>
          </a>
          {version && <p className="mt-2 px-3 text-[11px] text-slate-500">{version}</p>}
        </div>
      </div>
    </aside>
  );
}

function AISwitch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  // A plain native checkbox — simpler and more consistent with the rest
  // of the app than a bespoke pill-switch, which never stopped looking
  // out of place here however it was restyled.
  return (
    <label
      className={clsx(
        "flex items-center justify-between gap-2 text-[11px]",
        disabled ? "cursor-not-allowed text-slate-500" : "cursor-pointer text-slate-200"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}

function IconSparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2.8 14.2 9.8 21.2 12l-7 2.2-2.2 7-2.2-7-7-2.2 7-2.2 2.2-7Z" fill="currentColor" />
      <path d="m19 2 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L17 5l1.2-.8L19 2Z" fill="currentColor" />
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
function IconProcess({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 7h11.5M4 7l3-3M4 7l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 17H8.5M20 17l-3-3M20 17l-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
function IconSearch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.5 19.5 15 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.5 7.5v2M9.5 10.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconDownload({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 4v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 11 12 15.5 16.5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconDatabase({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 6v12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
