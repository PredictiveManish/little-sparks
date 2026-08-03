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


def _migrate_slack_config_columns():
    """Add refresh_token and token_expires_at columns to slack_config if missing.
    Safe to run on every startup — no-op if columns already exist."""
    if "sqlite" not in DATABASE_URL:
        logger.debug("Skipping SlackConfig migration (not SQLite)")
        return
    try:
        with engine.connect() as conn:
            # Read the raw CREATE TABLE statement from SQLite's internal schema
            result = conn.execute(
                text(
                    "SELECT sql FROM sqlite_master "
                    "WHERE type='table' AND name='slack_config'"
                )
            )
            row = result.fetchone()
            if not row or not row[0]:
                logger.warning(
                    "slack_config table not found; will be created by create_all"
                )
                return
            create_sql = row[0]
            if "refresh_token" not in create_sql:
                logger.info("Adding refresh_token column to slack_config")
                conn.execute(
                    text("ALTER TABLE slack_config ADD COLUMN refresh_token TEXT")
                )
                conn.commit()
            if "token_expires_at" not in create_sql:
                logger.info("Adding token_expires_at column to slack_config")
                conn.execute(
                    text(
                        "ALTER TABLE slack_config ADD COLUMN token_expires_at DATETIME"
                    )
                )
                conn.commit()
        logger.info("SlackConfig migration check completed successfully")
    except Exception as e:
        # Column might already exist (SQLite returns error on duplicate ADD COLUMN)
        logger.warning("SlackConfig migration encountered issue (likely no-op): %s", e)


def _add_column_if_missing(table_name, column_name, column_ddl):
    """Add a column to a table if it doesn't already exist. Works for both
    SQLite and Postgres using SQLAlchemy's inspector, so it's safe to call
    on every startup regardless of backend."""
    try:
        from sqlalchemy import inspect

        inspector = inspect(engine)
        existing_columns = {c["name"] for c in inspector.get_columns(table_name)}
        if column_name in existing_columns:
            return
        logger.info("Adding column %s.%s", table_name, column_name)
        with engine.connect() as conn:
            conn.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}")
            )
            conn.commit()
    except Exception as e:
        logger.warning(
            "Migration check for %s.%s encountered an issue (likely already applied): %s",
            table_name,
            column_name,
            e,
        )


def _migrate_reminder_columns():
    """Add the columns needed for daily/deadline reminder tracking if they're
    missing. Safe to run on every startup — no-op if already present."""
    is_sqlite = "sqlite" in DATABASE_URL
    text_type = "TEXT" if is_sqlite else "VARCHAR"
    ts_type = "DATETIME" if is_sqlite else "TIMESTAMP"
    _add_column_if_missing(
        "projects", "last_daily_reminder_date", f"{text_type} DEFAULT ''"
    )
    _add_column_if_missing("projects", "last_reminder_sent_at", ts_type)
    _add_column_if_missing(
        "phases", "deadline_reminder_sent", "BOOLEAN DEFAULT FALSE"
    )


def _migrate_stage_reports_table():
    """Add stage_reports table if it doesn't exist.
    Safe to run on every startup — no-op if already present."""
    try:
        from sqlalchemy import inspect

        inspector = inspect(engine)
        existing_tables = {t["name"] for t in inspector.get_tables()}
        if "stage_reports" in existing_tables:
            return
        logger.info("Adding stage_reports table")
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.warning(
            "Migration check for stage_reports encountered an issue (likely already applied): %s",
            e,
        )


def _migrate_stage_report_completion_columns():
    """Add actual_completion_date, delay_days, stage_completed columns to stage_reports if missing."""
    try:
        from sqlalchemy import inspect

        inspector = inspect(engine)
        existing_columns = {c["name"] for c in inspector.get_columns("stage_reports")}
        if "actual_completion_date" not in existing_columns:
            logger.info("Adding actual_completion_date column to stage_reports")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE stage_reports ADD COLUMN actual_completion_date TEXT"))
                conn.commit()
        if "delay_days" not in existing_columns:
            logger.info("Adding delay_days column to stage_reports")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE stage_reports ADD COLUMN delay_days INTEGER DEFAULT 0"))
                conn.commit()
        if "stage_completed" not in existing_columns:
            logger.info("Adding stage_completed column to stage_reports")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE stage_reports ADD COLUMN stage_completed BOOLEAN DEFAULT FALSE"))
                conn.commit()
    except Exception as e:
        logger.warning(
            "Migration check for stage_report completion columns encountered an issue (likely already applied): %s",
            e,
        )


def init_db():
    """Initialize database tables, run migrations, and WAL mode."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error("Failed to initialize database tables: %s", e)
        raise
    _migrate_slack_config_columns()
    _migrate_reminder_columns()
    _migrate_stage_reports_table()
    _migrate_stage_report_completion_columns()
    init_wal_mode()
