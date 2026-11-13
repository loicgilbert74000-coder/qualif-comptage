import uuid
import enum
from datetime import datetime, date

from sqlalchemy import String, DateTime, Date, Float, Integer, JSON, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ImportStatus(str, enum.Enum):
    A_VALIDER = "a_valider"
    A_CORRIGER = "a_corriger"
    VALIDE = "valide"
    REFUSE = "refuse"
    EN_COURS = "en_cours"


class ImportKind(str, enum.Enum):
    FICHIER = "fichier"
    DOSSIER = "dossier"


class ImportBatch(Base):
    """One import operation: a single CSV file, or a folder of CSV files
    processed together (as in the 'Dossier_Mensuel_2024 (12 fichiers)' row
    of the mock-up)."""

    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))              # display name, e.g. Relevés_B101_2024.csv
    kind: Mapped[ImportKind] = mapped_column(Enum(ImportKind), default=ImportKind.FICHIER)
    file_count: Mapped[int] = mapped_column(Integer, default=1)
    storage_path: Mapped[str] = mapped_column(String(512))       # where raw file(s) are kept on disk
    column_mapping: Mapped[dict] = mapped_column(JSON, default=dict)  # {"horodatage": "...", "id_compteur": "...", ...}
    delimiter: Mapped[str] = mapped_column(String(4), default=";")
    decimal_separator: Mapped[str] = mapped_column(String(1), default=",")

    building_count: Mapped[int] = mapped_column(Integer, default=0)
    meter_count: Mapped[int] = mapped_column(Integer, default=0)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100
    status: Mapped[ImportStatus] = mapped_column(Enum(ImportStatus), default=ImportStatus.EN_COURS)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    anomalies: Mapped[list["Anomaly"]] = relationship(back_populates="import_batch", cascade="all, delete-orphan")
    readings: Mapped[list["Reading"]] = relationship(back_populates="import_batch", cascade="all, delete-orphan")
    history_entries: Mapped[list["ProcessingHistory"]] = relationship(
        back_populates="import_batch", cascade="all, delete-orphan"
    )
