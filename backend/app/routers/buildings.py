from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Building, Meter, MeterStatus
from app.schemas.building import BuildingOut, BuildingCreate, MeterOut

router = APIRouter(prefix="/api/buildings", tags=["buildings"])

# A meter exists in the database from the moment its code is first seen in
# an import — long before anyone has reviewed or qualified it. Showing it
# here right away would mean "Bâtiments et compteurs" lists data that's
# still mid-review (or, for a refused import, not usable at all), so this
# page — like the "Base de données" viewer — only ever shows meters that
# have actually been qualified at least once.
_QUALIFIED_STATUSES = (MeterStatus.VALIDE, MeterStatus.CORRIGE)


@router.get("", response_model=list[BuildingOut])
def list_buildings(db: Session = Depends(get_db)):
    return (
        db.query(Building)
        .join(Meter, Meter.building_id == Building.id)
        .filter(Meter.status.in_(_QUALIFIED_STATUSES))
        .distinct()
        .order_by(Building.code)
        .all()
    )


@router.post("", response_model=BuildingOut)
def create_building(payload: BuildingCreate, db: Session = Depends(get_db)):
    if db.query(Building).filter(Building.code == payload.code).first():
        raise HTTPException(409, "Un bâtiment avec ce code existe déjà")
    b = Building(**payload.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.get("/{building_id}", response_model=BuildingOut)
def get_building(building_id: UUID, db: Session = Depends(get_db)):
    b = db.query(Building).get(building_id)
    if b is None:
        raise HTTPException(404, "Bâtiment introuvable")
    return b


@router.get("/{building_id}/meters", response_model=list[MeterOut])
def list_building_meters(building_id: UUID, db: Session = Depends(get_db)):
    return (
        db.query(Meter)
        .filter(Meter.building_id == building_id, Meter.status.in_(_QUALIFIED_STATUSES))
        .order_by(Meter.code)
        .all()
    )
