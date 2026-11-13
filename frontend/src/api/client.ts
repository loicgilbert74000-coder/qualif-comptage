import type {
  ImportBatchSummary,
  ImportBatchDetail,
  AnomalyOut,
  SeriesPoint,
  SynthesisOut,
  ValidateResponse,
  OrgSettings,
  Building,
  HistoryEntry,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listImports: () => request<ImportBatchSummary[]>("/imports"),

  uploadImport: async (files: File[]): Promise<ImportBatchSummary> => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<ImportBatchSummary>("/imports", { method: "POST", body: form });
  },

  getImport: (id: string) => request<ImportBatchDetail>(`/imports/${id}`),

  getSeries: (batchId: string, meterId: string) =>
    request<SeriesPoint[]>(`/imports/${batchId}/meters/${meterId}/series`),

  getAnomalies: (batchId: string) => request<AnomalyOut[]>(`/imports/${batchId}/anomalies`),

  getSynthesis: (batchId: string) => request<SynthesisOut>(`/imports/${batchId}/synthesis`),

  reanalyze: (batchId: string) =>
    request<ImportBatchSummary>(`/imports/${batchId}/reanalyze`, { method: "POST" }),

  reject: (batchId: string) => request<ImportBatchSummary>(`/imports/${batchId}/reject`, { method: "POST" }),

  validate: (batchId: string) =>
    request<ValidateResponse>(`/imports/${batchId}/validate`, { method: "POST" }),

  deleteImport: (batchId: string) => request<void>(`/imports/${batchId}`, { method: "DELETE" }),

  listBuildings: () => request<Building[]>("/buildings"),

  listHistory: () => request<HistoryEntry[]>("/history"),

  getSettings: () => request<OrgSettings>("/settings"),

  updateSettings: (payload: Partial<OrgSettings>) =>
    request<OrgSettings>("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
