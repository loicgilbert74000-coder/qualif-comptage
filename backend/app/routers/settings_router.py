from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.history import OrgSettingsOut, OrgSettingsUpdate
from app.services.import_service import get_org_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=OrgSettingsOut)
def read_settings(db: Session = Depends(get_db)):
    return get_org_settings(db)


@router.put("", response_model=OrgSettingsOut)
def update_settings(payload: OrgSettingsUpdate, db: Session = Depends(get_db)):
    row = get_org_settings(db)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row
