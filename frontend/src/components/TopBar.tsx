export default function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex items-start justify-between border-b border-gray-200 bg-white px-8 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4 pt-1">
        <button className="relative text-gray-500 hover:text-gray-700" aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
            <path
              d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500" />
        </button>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-geneva-700 text-white"
          aria-label="Compte utilisateur"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <circle cx="12" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.5 19c1.2-3.2 4-4.8 6.5-4.8s5.3 1.6 6.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
