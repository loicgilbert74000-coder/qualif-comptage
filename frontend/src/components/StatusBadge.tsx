import clsx from "clsx";
import type { ImportStatus } from "../types";

const LABELS: Record<ImportStatus, string> = {
  en_cours: "Analyse en cours",
  a_valider: "À valider",
  a_corriger: "À corriger",
  valide: "Validé",
  refuse: "Refusé",
  deja_traite: "Déjà traité",
};

const STYLES: Record<ImportStatus, string> = {
  en_cours: "bg-gray-100 text-gray-600",
  a_valider: "bg-blue-50 text-blue-700",
  a_corriger: "bg-red-50 text-red-700",
  valide: "bg-green-50 text-green-700",
  refuse: "bg-gray-200 text-gray-600",
  deja_traite: "bg-amber-50 text-amber-700",
};

export default function StatusBadge({ status }: { status: ImportStatus }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", STYLES[status])}>
      {LABELS[status]}
    </span>
  );
}
