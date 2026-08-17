from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    JSON,
    func,
)
from sqlalchemy.orm import relationship
from .database import Base
import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=True, default=None)
    role = Column(String, nullable=False, default="PENDING")
    specialty = Column(String, default="Designer")
    initials = Column(String, default="")
    color = Column(String, default="bg-blue-500")
    slack_user_id = Column(String, default="", nullable=True)
    slack_team_id = Column(String, default="", nullable=True)
    requested_role = Column(String, default="", nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    projects = relationship(
        "Project",
        back_populates="designer",
        foreign_keys="Project.assigned_designer_id",
    )


class ProjectManager(Base):
    """Junction table: many-to-many between Projects and Managers."""
    __tablename__ = "project_managers"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    assigned_designer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    stage_index = Column(Integer, default=0)
    progress = Column(Integer, default=0)
    deadline = Column(String, nullable=False)
    start_date = Column(String, nullable=False)
    status = Column(String, default="")
    manager_notes = Column(Text, default="")
    slack_channel_id = Column(String, default="")
    slack_channel_name = Column(String, default="")
    phase_type = Column(String, default="")
    stage_names = Column(JSON, default=list)
    last_daily_reminder_date = Column(String, default="", nullable=True)
    last_reminder_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    designer = relationship(
        "User", back_populates="projects", foreign_keys="Project.assigned_designer_id"
    )
    managers = relationship(
        "User",
        secondary="project_managers",
        primaryjoin="and_(Project.id == ProjectManager.project_id, ProjectManager.manager_id == User.id)",
        secondaryjoin="ProjectManager.project_id == Project.id",
        foreign_keys="[ProjectManager.project_id]",
        backref="managed_projects",
    )
    phases = relationship(
        "Phase", back_populates="project", cascade="all, delete-orphan"
    )
    slack_activities = relationship(
        "SlackActivity", back_populates="project", cascade="all, delete-orphan"
    )
    slack_messages = relationship(
        "SlackMessage", back_populates="project", cascade="all, delete-orphan"
    )
    stage_reports = relationship(
        "StageReport", back_populates="project", cascade="all, delete-orphan"
    )


class Phase(Base):
    __tablename__ = "phases"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    stage_index = Column(Integer, nullable=False)
    stage_name = Column(String, nullable=True, default=None)
    deadline = Column(String, nullable=False)
    designer_update = Column(Text, default="")
    delay_reason = Column(Text, default="")
    delay_responsible = Column(JSON, default=list)
    manager_remarks = Column(Text, nullable=True)
    completed_at = Column(String, default=None, nullable=True)
    assigned_designer_ids = Column(JSON, default=list)
    deadline_reminder_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    project = relationship("Project", back_populates="phases")


class SlackConfig(Base):
    __tablename__ = "slack_config"

    id = Column(Integer, primary_key=True, index=True)
    bot_token = Column(String, nullable=True)
    signing_secret = Column(String, nullable=False)
    slack_team_id = Column(String, default="")
    encrypted = Column(Boolean, default=False)
    refresh_token = Column(String, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )


class SlackActivity(Base):
    __tablename__ = "slack_activity"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    channel_id = Column(String, default="")
    message_ts = Column(String, default="")
    action_type = Column(String, default="")
    user_id = Column(String, default="")
    user_name = Column(String, default="")
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="slack_activities")


class SlackMessage(Base):
    __tablename__ = "slack_messages"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    slack_user_id = Column(String, default="")
    slack_user_name = Column(String, default="")
    channel_id = Column(String, default="")
    text = Column(Text, default="")
    ts = Column(String, default="")
    raw_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="slack_messages")


class StageReport(Base):
    __tablename__ = "stage_reports"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    stage_index = Column(Integer, nullable=False)
    stage_name = Column(String, nullable=False)
    submitted_by_user_id = Column(String, default="")
    submitted_by_name = Column(String, default="")
    submitted_by_role = Column(String, default="")
    slack_user_id = Column(String, default="")
    costing = Column(Integer, nullable=True)
    willingness_to_buy = Column(Integer, nullable=True)
    engagement_life = Column(Integer, nullable=True)
    durability = Column(Integer, nullable=True)
    age_appropriateness = Column(Integer, nullable=True)
    ease_of_use = Column(Integer, nullable=True)
    aesthetics = Column(Integer, nullable=True)
    easy_to_store = Column(Integer, nullable=True)
    notes = Column(Text, default="")
    actual_completion_date = Column(String, default=None, nullable=True)
    delay_days = Column(Integer, default=0)
    stage_completed = Column(Boolean, default=False)
    submitted_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="stage_reports")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False)

    user = relationship("User")


class SlackCompletionTracker(Base):
    """Tracks pending stage completions initiated via Slack messages.
    
    Flow:
    1. Designer says 'complete' in project channel → status=PENDING
    2. Manager says 'completed/approved' → status=CONFIRMED, auto-complete stage
    """
    __tablename__ = "slack_completion_tracker"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    stage_index = Column(Integer, nullable=False)
    designer_slack_user_id = Column(String, default="")
    designer_slack_user_name = Column(String, default="")
    designer_message = Column(Text, default="")
    manager_slack_user_id = Column(String, default="")
    manager_slack_user_name = Column(String, default="")
    manager_message = Column(Text, default="")
    status = Column(String, default="PENDING")  # PENDING | CONFIRMED | CANCELLED
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    confirmed_at = Column(DateTime, nullable=True)

    project = relationship("Project")
