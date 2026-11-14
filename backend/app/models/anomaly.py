import uuid
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum, Float
from app.db_types import GUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnomalyType(str, enum.Enum):
    INCOHERENCE = "incoherence"
    MANQUANTE = "manquante"


class AnomalyResolution(str, enum.Enum):
    EN_ATTENTE = "en_attente"   # not yet reviewed on the "Traiter et reconstruire" page
    VALIDEE = "validee"         # reviewed and kept as-is (legitimate event, no correction wanted)
    CORRIGEE = "corrigee"       # reviewed and corrected by simulation (profil type / interpolation)


class Anomaly(Base):
    """A detected period-level issue on one meter within one import batch,
    matching the 'Détail des anomalies' table of the mock-up (période / type
    / description)."""

    __tablename__ = "anomalies"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id", ondelete="CASCADE"))
    type: Mapped[AnomalyType] = mapped_column(Enum(AnomalyType))
    subtype: Mapped[str] = mapped_column(String(64))  # See quality_engine anomaly criteria.
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    description: Mapped[str] = mapped_column(String(512))
    deviation_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    resolution: Mapped[AnomalyResolution] = mapped_column(
        # server_default is the literal DDL value SQLAlchemy writes into
        # CREATE TABLE / a raw insert that omits this column; Enum() reads a
        # stored string back by the enum member's NAME, not its value, so
        # this must be "EN_ATTENTE", not "en_attente" (see main.py's startup
        # migration for the backstory on this exact mismatch).
        Enum(AnomalyResolution), default=AnomalyResolution.EN_ATTENTE, server_default="EN_ATTENTE"
    )

    import_batch: Mapped["ImportBatch"] = relationship(back_populates="anomalies")
    meter: Mapped["Meter"] = relationship()
