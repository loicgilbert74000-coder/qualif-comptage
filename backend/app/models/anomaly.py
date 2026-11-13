import uuid
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AnomalyType(str, enum.Enum):
    INCOHERENCE = "incoherence"
    MANQUANTE = "manquante"


class Anomaly(Base):
    """A detected period-level issue on one meter within one import batch,
    matching the 'Détail des anomalies' table of the mock-up (période / type
    / description)."""

    __tablename__ = "anomalies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id", ondelete="CASCADE"))
    type: Mapped[AnomalyType] = mapped_column(Enum(AnomalyType))
    subtype: Mapped[str] = mapped_column(String(64))  # pic, chute, valeur_negative, palier_suspect, absence_releve
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    description: Mapped[str] = mapped_column(String(512))
    deviation_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    import_batch: Mapped["ImportBatch"] = relationship(back_populates="anomalies")
    meter: Mapped["Meter"] = relationship()
