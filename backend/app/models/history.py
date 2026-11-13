import uuid
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ProcessingAction(str, enum.Enum):
    ANALYSE = "analyse"
    REANALYSE = "reanalyse"
    REFUSE = "refuse"
    VALIDE_ET_TRAITE = "valide_et_traite"


class ProcessingHistory(Base):
    """One row of the 'Historique des traitements' page: every action taken
    on an import batch, with a snapshot of the stats at that moment."""

    __tablename__ = "processing_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    action: Mapped[ProcessingAction] = mapped_column(Enum(ProcessingAction))
    performed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reconstruction_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)  # e.g. points reconstructed, quality before/after

    import_batch: Mapped["ImportBatch"] = relationship(back_populates="history_entries")
