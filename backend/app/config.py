from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://qualif:qualif@db:5432/qualif_comptage"
    storage_dir: str = "/data/imports"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Default quality-engine thresholds (overridable per-organisation via /api/settings)
    spike_deviation_pct: float = 60.0       # % above the reference average => "pic"
    drop_deviation_pct: float = 60.0        # % below the reference average => "chute"
    reference_window_periods: int = 30      # nb of comparable periods used to build the reference average
    flatline_min_run: int = 4               # nb of identical consecutive values => suspected stuck meter
    allow_negative_values: bool = False      # consumption meters should not read negative

    class Config:
        env_prefix = "QC_"


settings = Settings()
