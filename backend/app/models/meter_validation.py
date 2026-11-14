import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Float, UniqueConstraint
from app.db_types import GUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MeterValidation(Base):
    """Records that one meter's curve, within one import batch, has been
    saved ("Enregistrer la courbe en base de données") — independently of
    the other meters in the same dossier. A multi-meter import batch is
    only promoted to ImportStatus.VALIDE once every one of its meters has
    a row here; until then, each meter can be reviewed and saved on its
    own schedule instead of forcing the whole batch to be treated at
    once."""

    __tablename__ = "meter_validations"
    __table_args__ = (UniqueConstraint("import_batch_id", "meter_id", name="uq_meter_validations_batch_meter"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    import_batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id", ondelete="CASCADE"), index=True)
    validated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    points_reconstructed: Mapped[int] = mapped_column(Integer, default=0)
    points_smoothed: Mapped[int] = mapped_column(Integer, default=0)
    quality_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_after: Mapped[float | None] = mapped_column(Float, nullable=True)
