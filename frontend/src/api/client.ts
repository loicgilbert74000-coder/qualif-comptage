import type {
  ImportBatchSummary,
  ImportBatchDetail,
  AnomalyOut,
  SeriesPoint,
  SynthesisOut,
  ValidateResponse,
  ValidateMeterResponse,
  CorrectionOption,
  CorrectionPreviewPoint,
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

  resolveAnomaly: (
    batchId: string, anomalyId: string, resolution: "validee" | "corrigee", method?: string, comment?: string
  ) => request<AnomalyOut>(`/imports/${batchId}/anomalies/${anomalyId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolution, method: method ?? null, comment: comment ?? null }),
  }),

  getCorrectionOptions: (batchId: string, anomalyId: string) =>
    request<CorrectionOption[]>(`/imports/${batchId}/anomalies/${anomalyId}/correction-options`),

  getCorrectionPreview: (batchId: string, anomalyId: string, method: string) =>
    request<CorrectionPreviewPoint[]>(
      `/imports/${batchId}/anomalies/${anomalyId}/correction-preview?method=${encodeURIComponent(method)}`
    ),

  getSynthesis: (batchId: string) => request<SynthesisOut>(`/imports/${batchId}/synthesis`),

  reanalyze: (batchId: string) =>
    request<ImportBatchSummary>(`/imports/${batchId}/reanalyze`, { method: "POST" }),

  reject: (batchId: string) => request<ImportBatchSummary>(`/imports/${batchId}/reject`, { method: "POST" }),

  validate: (batchId: string) =>
    request<ValidateResponse>(`/imports/${batchId}/validate`, { method: "POST" }),

  validateMeter: (batchId: string, meterId: string) =>
    request<ValidateMeterResponse>(`/imports/${batchId}/meters/${meterId}/validate`, { method: "POST" }),

  deleteImport: (batchId: string) => request<void>(`/imports/${batchId}`, { method: "DELETE" }),

  exportBatch: async (batchId: string, format: "csv" | "json"): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`${BASE}/imports/${batchId}/export?format=${format}`);
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
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob, filename: match?.[1] ?? `export.${format}` };
  },

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
