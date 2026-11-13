import uuid

from sqlalchemy import String, Float
from app.db_types import GUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Building(Base):
    """A site / building (bâtiment). Generic on purpose: any organisation's
    building stock, not tied to a specific canton or typology list."""

    __tablename__ = "buildings"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # e.g. B101, S04
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    typology: Mapped[str | None] = mapped_column(String(128), nullable=True)
    surface_m2: Mapped[float | None] = mapped_column(Float, nullable=True)

    meters: Mapped[list["Meter"]] = relationship(back_populates="building", cascade="all, delete-orphan")
