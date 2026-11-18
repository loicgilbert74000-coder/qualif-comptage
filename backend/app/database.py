from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# The standalone desktop build (PyInstaller) runs on SQLite with no server to
# install; the Docker deployment uses PostgreSQL. SQLite needs
# check_same_thread=False because FastAPI/Starlette may serve requests from a
# different thread than the one that created the connection.
_is_sqlite = settings.database_url.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=_connect_args)

if _is_sqlite:
    # SQLite ignores every ON DELETE CASCADE in the schema unless foreign-key
    # enforcement is turned on per connection — it's off by default. Without
    # this, deleting an ImportBatch silently leaves behind any row that only
    # has a DB-level (not ORM-level) cascade pointing at it — e.g.
    # MeterValidation, whose cascade is declared solely via
    # ForeignKey(..., ondelete="CASCADE") and not as an ORM relationship on
    # ImportBatch — as a dangling reference to a batch that no longer
    # exists. PostgreSQL (the Docker deployment) always enforces this, so it
    # never needed this fix; SQLite (the desktop build) does.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
