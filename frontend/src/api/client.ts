import type {
  ImportBatchSummary,
  ImportBatchDetail,
  ImportPreview,
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
  SimplifiedReadingsPage,
  ReadingFilters,
  ReadingFilterOptions,
  ExportFormat,
  CriteriaProfile,
  CriteriaProfileUpdate,
  MeterQualitySummary,
} from "../types";

const BASE = "/api";

/** Most errors from the API are a plain string `detail`. A handful of
 * import-related endpoints instead send a structured object — `{ message,
 * filename, content_preview }` — when a file is genuinely unreadable, so the
 * import screen can show the user *why* (a raw excerpt of the file) instead
 * of just a one-line message. `ApiError` carries that extra data through to
 * the `catch` block when it's present, and behaves like a normal `Error`
 * (its `message` is just the text) when it's not. */
export class ApiError extends Error {
  filename?: string;
  contentPreview?: string;

  constructor(message: string, extra?: { filename?: string; contentPreview?: string }) {
    super(message);
    this.name = "ApiError";
    this.filename = extra?.filename;
    this.contentPreview = extra?.contentPreview;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail: string = res.statusText;
    let structured: { filename?: string; contentPreview?: string } | undefined;
    try {
      const body = await res.json();
      if (body.detail && typeof body.detail === "object") {
        detail = body.detail.message || detail;
        structured = { filename: body.detail.filename, contentPreview: body.detail.content_preview };
      } else {
        detail = body.detail || detail;
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, structured);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listImports: () => request<ImportBatchSummary[]>("/imports"),

  uploadImport: async (
    files: File[],
    selectedMeters?: string[],
    columnMapping?: Record<string, string>
  ): Promise<ImportBatchSummary> => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (selectedMeters) form.append("selected_meters", JSON.stringify(selectedMeters));
    if (columnMapping) form.append("column_mapping", JSON.stringify(columnMapping));
    return request<ImportBatchSummary>("/imports", { method: "POST", body: form });
  },

  previewImport: async (files: File[], columnMapping?: Record<string, string>): Promise<ImportPreview> => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (columnMapping) form.append("column_mapping", JSON.stringify(columnMapping));
    return request<ImportPreview>("/imports/preview", { method: "POST", body: form });
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

  resolveAllAnomalies: (batchId: string) =>
    request<{ resolved_count: number }>(`/imports/${batchId}/anomalies/resolve-all`, { method: "POST" }),

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

  getReadings: (limit: number, offset: number, filters?: ReadingFilters) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
    }
    return request<SimplifiedReadingsPage>(`/db/readings?${params.toString()}`);
  },

  getReadingFilterOptions: () => request<ReadingFilterOptions>("/db/readings/filter-options"),

  exportReadings: async (
    filters: ReadingFilters,
    format: ExportFormat
  ): Promise<{ blob: Blob; filename: string }> => {
    const params = new URLSearchParams({ format });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const res = await fetch(`${BASE}/db/export?${params.toString()}`);
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

  wipeDatabase: () => request<{ status: string }>("/db/wipe", { method: "POST" }),

  deleteMeter: (meterId: string) => request<{ status: string }>(`/db/meters/${meterId}`, { method: "DELETE" }),

  getCriteriaProfiles: () => request<CriteriaProfile[]>("/criteria-profiles"),

  updateCriteriaProfile: (profileId: number, payload: CriteriaProfileUpdate) =>
    request<CriteriaProfile>(`/criteria-profiles/${profileId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  setMeterUsageProfile: (batchId: string, meterId: string, profile: string | null) =>
    request<MeterQualitySummary>(`/imports/${batchId}/meters/${meterId}/usage-profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }),
};
