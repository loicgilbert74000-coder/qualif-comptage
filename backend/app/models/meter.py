import uuid
import enum

from sqlalchemy import String, ForeignKey, Date, Enum, Float
from app.db_types import GUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MeterStatus(str, enum.Enum):
    """Overall status of a meter's current data, independent of the
    per-reading quality flag (incohérence/manquante/reconstruite) and of
    whatever import batch last touched it — this is the one status a user
    checks to know "is this meter's curve usable right now"."""

    A_VALIDER = "a_valider"   # has readings, never been through validate_meter
    VALIDE = "valide"         # validated, no correction was needed
    CORRIGE = "corrige"       # validated, with at least one point reconstructed/smoothed
    INVALIDE = "invalide"     # its batch was refused — data not usable


class Meter(Base):
    """A counting point (compteur). The fluid/role/unit are free-text so the
    platform can ingest ANY meter type: électricité, gaz, eau, chaleur,
    mazout, granulés, chaleur à distance, sous-compteurs, livraisons, etc.
    New fluid types never require a schema or code change."""

    __tablename__ = "meters"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    building_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buildings.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(128), index=True)  # e.g. B101-ELEC-01, S04-PAC
    label: Mapped[str] = mapped_column(String(255))
    fluid_type: Mapped[str] = mapped_column(String(64))       # électricité, gaz, eau, chaleur, mazout, ...
    unit: Mapped[str] = mapped_column(String(32))              # kWh, m3, litre, kg, ...
    role: Mapped[str] = mapped_column(String(64), default="général")  # général, sous-compteur, production, livraison, injection
    measurement_kind: Mapped[str] = mapped_column(String(24), default="indéterminé", server_default="indéterminé")
    parent_meter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("meters.id", ondelete="SET NULL"), nullable=True
    )
    expected_frequency: Mapped[str] = mapped_column(String(16), default="auto")  # horaire, journaliere, mensuelle, auto
    service_start: Mapped[Date | None] = mapped_column(Date, nullable=True)
    service_end: Mapped[Date | None] = mapped_column(Date, nullable=True)

    status: Mapped[MeterStatus] = mapped_column(
        Enum(MeterStatus), default=MeterStatus.A_VALIDER, server_default="A_VALIDER"
    )
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100, latest validation's result

    building: Mapped["Building"] = relationship(back_populates="meters")
    readings: Mapped[list["Reading"]] = relationship(back_populates="meter", cascade="all, delete-orphan")
