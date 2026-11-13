from uuid import UUID

from pydantic import BaseModel


class MeterOut(BaseModel):
    id: UUID
    code: str
    label: str
    fluid_type: str
    unit: str
    role: str
    parent_meter_id: UUID | None

    class Config:
        from_attributes = True


class BuildingOut(BaseModel):
    id: UUID
    code: str
    name: str
    address: str | None
    typology: str | None
    surface_m2: float | None
    meters: list[MeterOut] = []

    class Config:
        from_attributes = True


class BuildingCreate(BaseModel):
    code: str
    name: str
    address: str | None = None
    typology: str | None = None
    surface_m2: float | None = None
