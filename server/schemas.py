from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


# ---------- Auth ----------


class LoginRequest(BaseModel):
    email: str
    password: str


class SlackLoginRequest(BaseModel):
    code: str
    redirect_uri: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class SessionResponse(BaseModel):
    session_token: str
    user: "UserResponse"


# ---------- User ----------


class UserBase(BaseModel):
    name: str
    email: str
    role: str = "DESIGNER"
    specialty: str = "Designer"
    initials: str = ""
    color: str = "bg-blue-500"


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: int

    class Config:
        from_attributes = True


class PendingUserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    requested_role: str
    slack_user_id: str

    class Config:
        from_attributes = True


class ApproveUserRequest(BaseModel):
    user_id: int
    role: str


# ---------- Phase ----------


class PhaseCreate(BaseModel):
    stage_index: int
    deadline: str


class PhaseResponse(BaseModel):
    id: int
    project_id: int
    stage_index: int
    deadline: str
    designer_update: str
    delay_reason: str
    completed_at: Optional[str] = None
    assigned_designer_ids: List[int] = []

    class Config:
        from_attributes = True


# ---------- Project ----------


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    assigned_designer_id: int
    start_date: str
    deadline: Optional[str] = None
    manager_notes: str = ""
    phases: List[PhaseCreate]
    created_by_user_id: int = 0
    manager_ids: List[int] = []
    phase_type: str = "PRODUCTION"
    stage_names: Optional[List[str]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    assigned_designer_id: Optional[int] = None
    start_date: Optional[str] = None
    deadline: Optional[str] = None
    manager_notes: Optional[str] = None
    delay_reason: Optional[str] = None
    slack_channel_id: Optional[str] = None
    slack_channel_name: Optional[str] = None
    manager_ids: Optional[List[int]] = None
    phase_type: Optional[str] = None
    stage_names: Optional[List[str]] = None
    phases: Optional[List[PhaseCreate]] = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    assigned_designer_id: int
    created_by_user_id: int
    stage_index: int
    progress: int
    deadline: str
    start_date: str
    status: str
    manager_notes: str
    slack_channel_id: str = ""
    slack_channel_name: str = ""
    phase_type: str = "PRODUCTION"
    stage_names: List[str] = []
    phases: List[PhaseResponse] = []
    managers: List["ProjectManagerResponse"] = []

    class Config:
        from_attributes = True


class ProjectManagerResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    specialty: str = ""
    initials: str = ""
    color: str = ""

    class Config:
        from_attributes = True


# ---------- Dashboard ----------


class DashboardStats(BaseModel):
    active_projects: int
    on_time: int
    completed: int
    delayed: int


class OverdueProject(BaseModel):
    id: int
    name: str
    assigned_designer: str
    deadline: str
    days_overdue: int
    stage_index: int


class DelayTrendPoint(BaseModel):
    month: str
    total_delay_days: int
    delayed_projects: int


class MonthlyTrendPoint(BaseModel):
    """Monthly trend for a project: avg_rating + delay across last 6-12 months."""
    month: str
    avg_rating: Optional[float] = None
    total_delay_days: int = 0
    delayed_stage_count: int = 0


class DesignerComparisonItem(BaseModel):
    """Single designer's performance for comparison ranking."""
    designer_id: int
    designer_name: str
    stages_completed: int = 0
    on_time: int = 0
    delayed: int = 0
    on_time_rate: Optional[float] = None
    avg_delay_days: Optional[float] = None


class DesignerTrendPoint(BaseModel):
    """Single designer's monthly on-time rate trend."""
    month: str
    on_time_rate: Optional[float] = None
    stages_completed: int = 0
    avg_delay_days: Optional[float] = None


# ---------- Stage Actions ----------


class StageCompleteRequest(BaseModel):
    stage_index: int


# ---------- Slack ----------


class SlackConfigCreate(BaseModel):
    bot_token: Optional[str] = None
    signing_secret: Optional[str] = None
    slack_team_id: str = ""


class SlackConfigResponse(BaseModel):
    id: int
    bot_token: str
    signing_secret: str
    slack_team_id: str
    encrypted: bool
    refresh_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SlackStatusResponse(BaseModel):
    configured: bool
    channel_id: str = ""
    channel_name: str = ""
    bot_token_set: bool = False
    refresh_token_set: bool = False
    token_expires_at: Optional[datetime] = None
    token_expiring_soon: bool = False
    connection_health: str = "unknown"


class SlackActivityResponse(BaseModel):
    id: int
    project_id: int
    channel_id: str
    message_ts: str
    action_type: str
    user_id: str
    user_name: str
    payload: dict
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SlackChannelCreateResponse(BaseModel):
    channel_id: str
    channel_name: str
    success: bool
    message: str = ""


class SlackMessageResponse(BaseModel):
    id: int
    project_id: Optional[int] = None
    slack_user_id: str
    slack_user_name: str
    channel_id: str
    text: str
    ts: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- Stage Reports ----------


class StageReportCreate(BaseModel):
    project_id: int
    stage_index: int
    stage_name: str
    submitted_by_user_id: str
    submitted_by_name: str
    submitted_by_role: str
    slack_user_id: str
    costing: Optional[int] = None
    willingness_to_buy: Optional[int] = None
    engagement_life: Optional[int] = None
    durability: Optional[int] = None
    age_appropriateness: Optional[int] = None
    ease_of_use: Optional[int] = None
    aesthetics: Optional[int] = None
    easy_to_store: Optional[int] = None
    notes: Optional[str] = ""
    actual_completion_date: Optional[str] = None
    delay_days: Optional[int] = 0
    stage_completed: Optional[bool] = False


class StageReportResponse(BaseModel):
    id: int
    project_id: int
    stage_index: int
    stage_name: str
    submitted_by_user_id: str
    submitted_by_name: str
    submitted_by_role: str
    slack_user_id: str
    costing: Optional[int] = None
    willingness_to_buy: Optional[int] = None
    engagement_life: Optional[int] = None
    durability: Optional[int] = None
    age_appropriateness: Optional[int] = None
    ease_of_use: Optional[int] = None
    aesthetics: Optional[int] = None
    easy_to_store: Optional[int] = None
    notes: Optional[str] = ""
    submitted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StageReportSummary(BaseModel):
    project_id: int
    project_name: str
    assigned_designer: str
    stage_index: int
    stage_name: str
    total_reports: int
    avg_costing: Optional[float] = None
    avg_willingness_to_buy: Optional[float] = None
    avg_engagement_life: Optional[float] = None
    avg_durability: Optional[float] = None
    avg_age_appropriateness: Optional[float] = None
    avg_ease_of_use: Optional[float] = None
    avg_aesthetics: Optional[float] = None
    avg_easy_to_store: Optional[float] = None
    latest_report_id: Optional[int] = None
    latest_submitted_at: Optional[datetime] = None


# ---------- Project Reports (downloadable) ----------


class ProjectReportResponse(BaseModel):
    """Overall phasewise report for a project."""
    project_id: int
    project_name: str
    assigned_designer: str
    start_date: str
    deadline: str
    status: str
    progress: int
    stage_index: int
    phases: List["PhaseReportItem"] = []
    stage_reports: List[StageReportResponse] = []
    manager_notes: str = ""
    generated_at: Optional[str] = None


class PhaseReportItem(BaseModel):
    stage_index: int
    stage_name: str
    deadline: str
    completed_at: Optional[str] = None
    designer_update: str = ""
    delay_reason: str = ""
    assigned_designer_ids: List[int] = []
    is_current: bool = False
    delay_days: int = 0


class WeeklyReportResponse(BaseModel):
    """Weekly report: designer/project activity for a given week."""
    week_start: str
    week_end: str
    summary: Optional[dict] = None
    reports: List["WeeklyReportItem"] = []


class WeeklyActivityItem(BaseModel):
    type: str = ""
    submitted_by: str = ""
    submitted_at: Optional[str] = None
    ratings: Optional[dict] = None
    notes: Optional[str] = None


class WeeklyReportItem(BaseModel):
    project_id: int
    project_name: str
    assigned_designer: str
    stage_index: int
    stage_name: str
    status: str
    progress: int
    deadline: str = ""
    designer_update: str = ""
    delay_reason: str = ""
    completed_at: Optional[str] = None
    stage_reports: List[StageReportResponse] = []
    completed_this_week: bool = False
    activities: List[WeeklyActivityItem] = []
    progress_change: int = 0
    delay_occurred: bool = False
    delay_days: int = 0


class MonthlyReportResponse(BaseModel):
    """Monthly report: designer/project activity for a given month."""
    month: str
    year: int
    summary: Optional[dict] = None
    reports: List["MonthlyReportItem"] = []


class MonthlyActivityItem(BaseModel):
    type: str = ""
    submitted_by: str = ""
    date: Optional[str] = None
    notes: Optional[str] = None


class MonthlyReportItem(BaseModel):
    project_id: int
    project_name: str
    assigned_designer: str
    stage_index: int
    stage_name: str
    status: str
    progress: int
    deadline: str = ""
    completed_at: Optional[str] = None
    delay_days: Optional[int] = 0
    delay_reason: str = ""
    designer_updates: List[str] = []
    delays: List[str] = []
    stage_reports: List[StageReportResponse] = []
    completed_this_month: bool = False
    submissions_count: int = 0
    notes_count: int = 0
    avg_ratings: Optional[dict] = None
    rating_trends: Optional[dict] = None
    activities: List[MonthlyActivityItem] = []


class DesignerPerformanceResponse(BaseModel):
    """Designer performance report (weekly/monthly)."""
    designer_id: int
    designer_name: str
    period_start: str
    period_end: str
    projects: List["DesignerProjectItem"] = []
    total_updates: int = 0
    total_delays: int = 0
    total_stages_completed: int = 0
    total_on_time: int = 0


class DesignerProjectItem(BaseModel):
    project_id: int
    project_name: str
    stage_index: int
    stage_name: str
    status: str
    progress: int
    deadline: str = ""
    completed_at: Optional[str] = None
    delay_days: int = 0
    delay_reason: str = ""
    updates_count: int = 0
    delays_count: int = 0


# ---------- Slack Completion Tracker ----------


class SlackCompletionTrackerResponse(BaseModel):
    id: int
    project_id: int
    stage_index: int
    designer_slack_user_id: str
    designer_slack_user_name: str
    designer_message: str
    manager_slack_user_id: str = ""
    manager_slack_user_name: str = ""
    manager_message: str = ""
    status: str
    created_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SlackCompletionCancelResponse(BaseModel):
    success: bool
    message: str
