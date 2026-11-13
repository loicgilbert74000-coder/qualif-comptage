from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# The standalone desktop build (PyInstaller) runs on SQLite with no server to
# install; the Docker deployment uses PostgreSQL. SQLite needs
# check_same_thread=False because FastAPI/Starlette may serve requests from a
# different thread than the one that created the connection.
_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
