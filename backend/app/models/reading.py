import uuid
import enum
from datetime import datetime

from sqlalchemy import Float, DateTime, ForeignKey, Enum, String
from app.db_types import GUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReadingQuality(str, enum.Enum):
    VALIDE = "valide"
    INCOHERENCE = "incoherence"
    MANQUANTE = "manquante"
    RECONSTRUITE = "reconstruite"   # filled/smoothed by the simulation engine


class Reading(Base):
    """One timestamped value for one meter, coming from one import batch.
    `value` is the value as read (None for a reconstructed point until
    treatment runs); `raw_value` always preserves what was actually in the
    source file, even after reconstruction overwrites `value`."""

    __tablename__ = "readings"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id", ondelete="CASCADE"), index=True)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(32))
    quality: Mapped[ReadingQuality] = mapped_column(Enum(ReadingQuality), default=ReadingQuality.VALIDE)

    meter: Mapped["Meter"] = relationship(back_populates="readings")
    import_batch: Mapped["ImportBatch"] = relationship(back_populates="readings")

    __table_args__ = ()
