import uuid

from sqlalchemy import String, ForeignKey, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Meter(Base):
    """A counting point (compteur). The fluid/role/unit are free-text so the
    platform can ingest ANY meter type: électricité, gaz, eau, chaleur,
    mazout, granulés, chaleur à distance, sous-compteurs, livraisons, etc.
    New fluid types never require a schema or code change."""

    __tablename__ = "meters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buildings.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(128), index=True)  # e.g. B101-ELEC-01, S04-PAC
    label: Mapped[str] = mapped_column(String(255))
    fluid_type: Mapped[str] = mapped_column(String(64))       # électricité, gaz, eau, chaleur, mazout, ...
    unit: Mapped[str] = mapped_column(String(32))              # kWh, m3, litre, kg, ...
    role: Mapped[str] = mapped_column(String(64), default="général")  # général, sous-compteur, production, livraison, injection
    parent_meter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("meters.id", ondelete="SET NULL"), nullable=True
    )
    expected_frequency: Mapped[str] = mapped_column(String(16), default="auto")  # horaire, journaliere, mensuelle, auto
    service_start: Mapped[Date | None] = mapped_column(Date, nullable=True)
    service_end: Mapped[Date | None] = mapped_column(Date, nullable=True)

    building: Mapped["Building"] = relationship(back_populates="meters")
    readings: Mapped[list["Reading"]] = relationship(back_populates="meter", cascade="all, delete-orphan")
