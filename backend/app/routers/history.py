from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ProcessingHistory, ImportBatch
from app.schemas.history import HistoryEntryOut

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=list[HistoryEntryOut])
def list_history(db: Session = Depends(get_db)):
    rows = (
        db.query(ProcessingHistory, ImportBatch.name)
        .join(ImportBatch, ImportBatch.id == ProcessingHistory.import_batch_id)
        .order_by(ProcessingHistory.performed_at.desc())
        .all()
    )
    return [
        HistoryEntryOut(
            id=h.id,
            import_batch_id=h.import_batch_id,
            import_batch_name=name,
            action=h.action.value,
            performed_at=h.performed_at,
            reconstruction_method=h.reconstruction_method,
            stats=h.stats or {},
        )
        for h, name in rows
    ]
