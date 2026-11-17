from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CriteriaProfile
from app.schemas.criteria_profile import CriteriaProfileOut, CriteriaProfileUpdate
from app.services.criteria_profiles import seed_default_profiles, KIND_LABELS, USAGE_LABELS

router = APIRouter(prefix="/api/criteria-profiles", tags=["criteria-profiles"])


@router.get("", response_model=list[CriteriaProfileOut])
def list_criteria_profiles(db: Session = Depends(get_db)):
    """Every profile, grouped on the frontend by measurement_kind then
    usage_profile — one editable set of thresholds per combination, shown
    alongside the matching entries on the 'Types d'erreurs' page rather
    than in a separate, disconnected settings screen."""
    seed_default_profiles(db)  # no-op once already seeded
    profiles = db.query(CriteriaProfile).all()
    order = {k: i for i, k in enumerate(KIND_LABELS)}
    usage_order = {u: i for i, u in enumerate(USAGE_LABELS)}
    profiles.sort(key=lambda p: (order.get(p.measurement_kind, 99), usage_order.get(p.usage_profile, 99)))
    return profiles


@router.put("/{profile_id}", response_model=CriteriaProfileOut)
def update_criteria_profile(profile_id: int, payload: CriteriaProfileUpdate, db: Session = Depends(get_db)):
    profile = db.query(CriteriaProfile).get(profile_id)
    if profile is None:
        raise HTTPException(404, "Profil de critères introuvable.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(profile, k, v)
    db.commit()
    db.refresh(profile)
    return profile
