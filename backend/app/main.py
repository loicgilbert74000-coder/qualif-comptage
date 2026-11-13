from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.models import Base
from app.routers import imports, buildings, history, settings_router

app = FastAPI(title="Qualification des données de comptage", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


app.include_router(imports.router)
app.include_router(buildings.router)
app.include_router(history.router)
app.include_router(settings_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
