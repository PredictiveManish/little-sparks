from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os

load_dotenv()

# Use Postgres on Render, SQLite locally
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smartivity.db")

if "postgres" in DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=10,
        max_overflow=20,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_wal_mode():
    """Enable WAL mode for better SQLite concurrency."""
    if "sqlite" in DATABASE_URL:
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()


def init_db():
    """Initialize database tables and WAL mode."""
    Base.metadata.create_all(bind=engine)
    init_wal_mode()
