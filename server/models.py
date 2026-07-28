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

    projects = relationship("Project", back_populates="designer")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    assigned_designer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    stage_index = Column(Integer, default=0)
    progress = Column(Integer, default=0)
    deadline = Column(String, nullable=False)
    start_date = Column(String, nullable=False)
    status = Column(String, default="ON_TRACK")
    priority = Column(String, default="MEDIUM")
    manager_notes = Column(Text, default="")
    slack_channel_id = Column(String, default="")
    slack_channel_name = Column(String, default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    designer = relationship("User", back_populates="projects")
    phases = relationship(
        "Phase", back_populates="project", cascade="all, delete-orphan"
    )
    whatsapp_messages = relationship(
        "WhatsAppMessage", back_populates="project", cascade="all, delete-orphan"
    )
    slack_activities = relationship(
        "SlackActivity", back_populates="project", cascade="all, delete-orphan"
    )
    slack_messages = relationship(
        "SlackMessage", back_populates="project", cascade="all, delete-orphan"
    )


class Phase(Base):
    __tablename__ = "phases"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    stage_index = Column(Integer, nullable=False)
    deadline = Column(String, nullable=False)
    designer_update = Column(Text, default="")
    delay_reason = Column(Text, default="")
    completed_at = Column(String, default=None, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    project = relationship("Project", back_populates="phases")


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_sent = Column(Boolean, default=False)
    timestamp = Column(String, nullable=False)
    quick_replies = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("Project", back_populates="whatsapp_messages")


class SlackConfig(Base):
    __tablename__ = "slack_config"

    id = Column(Integer, primary_key=True, index=True)
    bot_token = Column(String, nullable=False)
    signing_secret = Column(String, nullable=False)
    slack_team_id = Column(String, default="")
    encrypted = Column(Boolean, default=False)
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


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False)

    user = relationship("User")
