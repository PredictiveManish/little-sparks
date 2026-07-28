from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os
import logging

logger = logging.getLogger("smartivity.database")

load_dotenv()

# Use Postgres on Render, SQLite locally
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smartivity.db")

if "postgres" in DATABASE_URL:
    logger.info("Creating PostgreSQL database engine")
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=10,
        max_overflow=20,
    )
    logger.info("PostgreSQL engine created successfully")
else:
    logger.info(
        "Creating SQLite database engine | path=%s",
        DATABASE_URL.replace("sqlite:///./", ""),
    )
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    logger.info("SQLite engine created successfully")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error("Database session error: %s", e)
        db.rollback()
        raise
    finally:
        db.close()
        logger.debug("Database session closed")


def init_wal_mode():
    """Enable WAL mode for better SQLite concurrency."""
    if "sqlite" in DATABASE_URL:
        try:
            with engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL"))
                conn.commit()
            logger.info("SQLite WAL mode enabled successfully")
        except Exception as e:
            logger.warning("Failed to enable SQLite WAL mode: %s", e)
    else:
        logger.debug("Skipping WAL mode (not SQLite)")


def init_db():
    """Initialize database tables and WAL mode."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize database tables: %s", e)
        raise
    init_wal_mode()
