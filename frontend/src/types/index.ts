export type ImportStatus = "en_cours" | "a_valider" | "a_corriger" | "valide" | "refuse" | "deja_traite";
export type ImportKind = "fichier" | "dossier";
export type Granularity = "15min" | "30min" | "horaire" | "journaliere" | "mensuelle";
export type PointQuality = "valide" | "incoherence" | "manquante" | "reconstruite";
export type AnomalyType = "incoherence" | "manquante";

export interface ImportBatchSummary {
  id: string;
  name: string;
  kind: ImportKind;
  file_count: number;
  building_count: number;
  meter_count: number;
  period_start: string | null;
  period_end: string | null;
  quality_score: number | null;
  status: ImportStatus;
  created_at: string;
}

export interface MeterQualitySummary {
  meter_id: string;
  meter_code: string;
  fluid_type: string;
  role: string;
  measurement_kind: string;
  unit: string;
  granularity: Granularity;
  total_expected: number;
  valid_count: number;
  incoherence_count: number;
  missing_count: number;
  quality_pct: number;
  saved: boolean;
}

export interface ImportBatchDetail {
  summary: ImportBatchSummary;
  building_name: string | null;
  meters: MeterQualitySummary[];
}

export type AnomalyResolution = "en_attente" | "validee" | "corrigee";
export type RecommendedAction = "corriger" | "valider" | "a_decider";

export interface AnomalyOut {
  id: string;
  meter_id: string;
  meter_code: string;
  type: AnomalyType;
  subtype: string;
  period_start: string;
  period_end: string;
  description: string;
  deviation_pct: number | null;
  resolution: AnomalyResolution;
  diagnosis: string;
  suggestion: string;
  recommended_action: RecommendedAction;
}

export interface SeriesPoint {
  timestamp: string;
  value: number | null;
  quality: PointQuality;
}

export interface CorrectionOption {
  method: string;
  label: string;
  description: string;
}

export interface CorrectionPreviewPoint {
  timestamp: string;
  current_value: number | null;
  proposed_value: number | null;
}

export interface SynthesisOut {
  quality_score: number;
  valid_points: number;
  incoherence_points: number;
  missing_points: number;
  total_points: number;
  by_meter: MeterQualitySummary[];
}

export interface ValidateResponse {
  status: string;
  points_reconstructed: number;
  points_smoothed: number;
  quality_before: number | null;
  quality_after: number;
}

export interface ValidateMeterResponse {
  status: string;
  meter_id: string;
  points_reconstructed: number;
  points_smoothed: number;
  quality_before: number | null;
  quality_after: number;
  batch_complete: boolean;
}

export interface OrgSettings {
  spike_deviation_pct: number;
  drop_deviation_pct: number;
  reference_window_periods: number;
  flatline_min_run: number;
  allow_negative_values: boolean;
  historical_min_points: number;
  robust_mad_multiplier: number;
  historical_extreme_ratio: number;
  zero_active_min_history: number;
  seasonal_activity_min_history: number;
  timestamp_tolerance_pct: number;
}

export interface Meter {
  id: string;
  code: string;
  label: string;
  fluid_type: string;
  unit: string;
  role: string;
  measurement_kind: string;
  parent_meter_id: string | null;
}

export interface Building {
  id: string;
  code: string;
  name: string;
  address: string | null;
  typology: string | null;
  surface_m2: number | null;
  meters: Meter[];
}

export interface HistoryEntry {
  id: string;
  import_batch_id: string;
  import_batch_name: string;
  action: string;
  performed_at: string;
  reconstruction_method: string | null;
  stats: Record<string, unknown>;
}
