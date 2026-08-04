from fastapi import FastAPI, Depends, HTTPException, status, Request, Cookie, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
from jose import jwt
from itsdangerous import Signer, BadSignature
from cryptography.fernet import Fernet, InvalidToken
import argon2
import hashlib
import hmac
import hashlib as hashlib_lib
import base64
import json
import httpx
import os
import urllib.parse
import logging
from logging.handlers import RotatingFileHandler
import sys
import traceback

import threading
import time as time_module
import csv
import io
import re
from zoneinfo import ZoneInfo

# ---------- Structured logging setup ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        RotatingFileHandler(
            "smartivity.log",
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        ),
    ],
)
logger = logging.getLogger("smartivity")
logger.info("Logging initialized")

from .database import get_db, init_db, SessionLocal
from .models import (
    Base,
    User,
    Project,
    Phase,
    SlackConfig,
    SlackActivity,
    SlackMessage,
    StageReport,
    Session as SessionModel,
    ProjectManager,
)
from .schemas import (
    LoginRequest,
    UserResponse,
    UserCreate,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    PhaseResponse,
    DashboardStats,
    RecentProject,
    UpcomingDeadline,
    SlackConfigCreate,
    SlackConfigResponse,
    SlackActivityResponse,
    SlackChannelCreateResponse,
    SlackStatusResponse,
    SlackLoginRequest,
    PendingUserResponse,
    ApproveUserRequest,
    SlackMessageResponse,
    StageReportCreate,
    StageReportResponse,
    StageReportSummary,
    ProjectReportResponse,
    PhaseReportItem,
    WeeklyReportResponse,
    WeeklyReportItem,
    MonthlyReportResponse,
    MonthlyReportItem,
    DesignerPerformanceResponse,
    DesignerProjectItem,
    ProjectManagerResponse,
)

# ---------- Init ----------
init_db()

# ---------- App ----------
app = FastAPI(title="Smartivity Designer Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,https://little-sparks-six.vercel.app",
        ).split(",")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Secrets from env ----------
SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is required. "
        'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
if not ENCRYPTION_KEY:
    raise RuntimeError(
        "ENCRYPTION_KEY environment variable is required. "
        'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
    )
else:
    try:
        fernet = Fernet(
            ENCRYPTION_KEY.encode()
            if isinstance(ENCRYPTION_KEY, str)
            else ENCRYPTION_KEY
        )
    except Exception:
        raise RuntimeError("ENCRYPTION_KEY is not a valid Fernet key")

ALGORITHM = "HS256"
SESSION_COOKIE_NAME = "smartivity_session"
SESSION_LIFETIME_DAYS = 90
SLACK_CLIENT_ID = os.getenv("SLACK_CLIENT_ID", "")
SLACK_CLIENT_SECRET = os.getenv("SLACK_CLIENT_SECRET", "")
SLACK_TEAM_ID = os.getenv("SLACK_TEAM_ID", "")
SLACK_REDIRECT_URI = os.getenv(
    "SLACK_REDIRECT_URI", "http://localhost:8000/api/slack/oauth/callback"
)

# ---------- Slack Bot Install (oauth.v2.access) — separate from Login-with-Slack (OIDC) above ----------
SLACK_BOT_REDIRECT_URI = os.getenv(
    "SLACK_BOT_REDIRECT_URI", "http://localhost:8000/api/slack/install/callback"
)
SLACK_BOT_SCOPES = os.getenv(
    "SLACK_BOT_SCOPES",
    "chat:write,channels:manage,groups:write,users:read,users:read.email,commands",
)
SLACK_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET", "")
INSTALL_STATE_COOKIE = "slack_install_state"
STATE_COOKIE_NAME = "slack_oauth_state"

# ---------- Reminder scheduling ----------
# Shared secret an external cron service (or the in-process scheduler below)
# must present to trigger /api/cron/tick. Required for the endpoint to do
# anything — without it the endpoint just reports itself as unconfigured.
CRON_SECRET = os.getenv("CRON_SECRET", "")
REMINDER_TIMEZONE = ZoneInfo(os.getenv("REMINDER_TIMEZONE", "Asia/Kolkata"))
DAILY_REMINDER_HOUR = int(os.getenv("DAILY_REMINDER_HOUR", "10"))
# How often the in-process scheduler wakes up to check (only matters while the
# dyno is awake — e.g. on a paid/always-on Render plan). An external cron
# hitting /api/cron/tick is still required on the free tier since the process
# sleeps and this thread sleeps with it.
SCHEDULER_INTERVAL_SECONDS = int(os.getenv("SCHEDULER_INTERVAL_SECONDS", "300"))

# ---------- Password hashing ----------
argon2_hasher = argon2.PasswordHasher()

# ---------- Seed admin user on startup (only if not exists) ----------
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "manish.tiwari.09@zohomail.in")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Manish@smartivity123")
ADMIN_NAME = os.getenv("ADMIN_NAME", "Manish Tiwari")

db = SessionLocal()
try:
    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if not existing:
        user = User(
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            password_hash=argon2_hasher.hash(ADMIN_PASSWORD),
            role="ADMIN",
            specialty="Product Manager",
            initials="MT",
            color="bg-purple-500",
        )
        db.add(user)
        db.commit()
        print(f"Admin user created: {ADMIN_EMAIL}")
    else:
        if existing.role.upper() != "ADMIN":
            existing.role = "ADMIN"
            db.commit()
            print(f"Admin role corrected: {ADMIN_EMAIL}")
        else:
            print(f"Admin user already exists: {ADMIN_EMAIL}")
finally:
    db.close()


def hash_password(password: str) -> str:
    return argon2_hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        argon2_hasher.verify(hashed, password)
        return True
    except argon2.exceptions.VerifyMismatchError:
        logger.warning(
            "Password verification failed for hashed password starting with: %s...",
            hashed[:20],
        )
        return False


# ---------- JWT helpers (for legacy / token responses) ----------


def create_jwt_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=24)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ---------- Session helpers ----------


def create_session_token() -> str:
    return os.urandom(48).hex()


def create_session(user_id: int, db: Session) -> SessionModel:
    token = create_session_token()
    expires = datetime.utcnow() + timedelta(days=SESSION_LIFETIME_DAYS)
    session = SessionModel(
        session_token=token,
        user_id=user_id,
        expires_at=expires,
        revoked=False,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(
        "Session created: user_id=%s, session_token=%s, expires_at=%s",
        user_id,
        token,
        expires,
    )
    return session


def get_session_from_token(token: str, db: Session) -> Optional[SessionModel]:
    if not token:
        logger.debug("Session token missing from request")
        return None
    session = (
        db.query(SessionModel)
        .filter(
            SessionModel.session_token == token,
            SessionModel.revoked == False,
        )
        .first()
    )
    if not session:
        logger.warning("Session not found for token: %s...", token[:20])
        return None
    if session.expires_at and session.expires_at < datetime.utcnow():
        session.revoked = True
        db.commit()
        logger.warning(
            "Session expired: user_id=%s, session_id=%s, expired_at=%s",
            session.user_id,
            session.id,
            session.expires_at,
        )
        return None
    return session


def revoke_session(session_id: int, db: Session):
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if session:
        session.revoked = True
        db.commit()
        logger.info(
            "Session revoked: session_id=%s, user_id=%s", session_id, session.user_id
        )


# ---------- Auth dependency ----------

VALID_ROLES = {"DESIGNER", "MANAGER", "ADMIN"}


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        logger.debug(
            "Auth: no session cookie | path=%s | IP=%s",
            request.url.path if request else "unknown",
            request.client.host if request and request.client else "unknown",
        )
    session = get_session_from_token(session_token, db)
    if not session:
        logger.debug(
            "Auth: session invalid/expired for path=%s | IP=%s",
            request.url.path if request else "unknown",
            request.client.host if request and request.client else "unknown",
        )
        return None
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        logger.warning(
            "Auth: user not found for session_id=%s | path=%s | IP=%s",
            session.id,
            request.url.path if request else "unknown",
            request.client.host if request and request.client else "unknown",
        )
        return None
    if user.role.upper() not in {r.upper() for r in VALID_ROLES}:
        logger.warning(
            "Auth: user role not valid: user_id=%s | role=%s | path=%s",
            user.id,
            user.role,
            request.url.path if request else "unknown",
        )
        return None
    logger.debug(
        "Auth: user authenticated | user_id=%s | role=%s | path=%s",
        user.id,
        user.role,
        request.url.path if request else "unknown",
    )
    return user


def require_admin(user: User = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    if user.role.upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_role(required: List[str]):
    def _dep(user: User = Depends(get_current_user)):
        if not user or user.role.upper() not in {r.upper() for r in required}:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return _dep


def get_user_owned_project_query(db, user):
    """Return a Project query filtered to user's own projects if manager.

    Admins get all projects. Managers get only projects they created OR are assigned to.
    Designers get no projects (they have no project access).
    """
    q = db.query(Project)
    if user.role.upper() == "DESIGNER":
        return q.filter(Project.id == -1)  # return empty
    if user.role.upper() == "MANAGER":
        q = q.filter(
            db.or_(
                Project.created_by_user_id == user.id,
                Project.id.in_(
                    db.query(ProjectManager.project_id).filter(
                        ProjectManager.manager_id == user.id
                    )
                ),
            )
        )
    return q


def filter_user_projects(db, user, project_ids):
    """Filter a list of project IDs to only those the user is allowed to see."""
    if user.role.upper() == "ADMIN":
        return project_ids
    if user.role.upper() == "MANAGER":
        owned = (
            db.query(Project.id)
            .filter(
                db.or_(
                    Project.created_by_user_id == user.id,
                    Project.id.in_(
                        db.query(ProjectManager.project_id).filter(
                            ProjectManager.manager_id == user.id
                        )
                    ),
                ),
                Project.id.in_(project_ids),
            )
            .all()
        )
        return [p[0] for p in owned]


# ---------- Cookie helpers ----------


def set_session_cookie(response: Response, session_token: str):
    is_dev = os.getenv("ENV") == "development"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=SESSION_LIFETIME_DAYS * 86400,
        path="/",
    )


def clear_session_cookie(response: Response):
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
    )


# ---------- Slack token encryption ----------

_slack_api_lock = threading.Lock()


def encrypt_token(plaintext: str) -> str:
    return fernet.encrypt(plaintext.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    try:
        return fernet.decrypt(encrypted.encode()).decode()
    except InvalidToken:
        logger.error(
            "Token decryption failed: InvalidToken exception for token starting with: %s...",
            encrypted[:20] if encrypted else "None",
        )
        return None


# ---------- Slack token refresh (token rotation support) ----------


async def refresh_slack_token(db):
    """Exchange the stored refresh_token for a new access_token + refresh_token.
    Returns (success: bool, error_message: str or None)."""
    config = get_slack_config(db)
    if not config:
        return False, "No Slack configuration found"
    if not config.refresh_token:
        return (
            False,
            "No refresh_token stored — token rotation may not be enabled on your Slack app",
        )
    try:
        decrypted_refresh = decrypt_token(config.refresh_token)
        if not decrypted_refresh:
            return False, "Failed to decrypt refresh_token"
    except Exception as e:
        return False, f"Failed to decrypt refresh_token: {e}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://slack.com/api/oauth.v2.access",
                data={
                    "client_id": SLACK_CLIENT_ID,
                    "client_secret": SLACK_CLIENT_SECRET,
                    "grant_type": "refresh_token",
                    "refresh_token": decrypted_refresh,
                },
                timeout=10.0,
            )
            result = resp.json()
        if not result.get("ok"):
            error = result.get("error", "unknown")
            logger.error(
                "[SLACK REFRESH] Token refresh failed | error=%s | response=%s",
                error,
                json.dumps(result)[:500],
            )
            return False, f"Token refresh failed: {error}"
        new_bot_token = result.get("access_token", "")
        new_refresh_token = result.get("refresh_token", "")
        expires_in = result.get("expires_in", 0)
        team_id = result.get("team", {}).get("id", "")
        with _slack_api_lock:
            config.bot_token = encrypt_token(new_bot_token)
            config.slack_team_id = team_id or config.slack_team_id
            if new_refresh_token:
                config.refresh_token = encrypt_token(new_refresh_token)
            if expires_in:
                config.token_expires_at = datetime.utcnow() + timedelta(
                    seconds=expires_in
                )
            db.commit()
        logger.info(
            "[SLACK REFRESH] Token refreshed successfully | team_id=%s | new_token=%s... | expires_in=%ss",
            team_id,
            new_bot_token[:10] if new_bot_token else "None",
            expires_in,
        )
        return True, None
    except Exception as e:
        logger.error(
            "[SLACK REFRESH] Unexpected error during token refresh | error=%s", e
        )
        return False, str(e)


def _is_token_expiring_soon(token_expires_at):
    """Check if the token is expiring within 10 minutes."""
    if not token_expires_at:
        return False
    if isinstance(token_expires_at, str):
        try:
            token_expires_at = datetime.strptime(token_expires_at, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return False
    now = datetime.utcnow()
    return (token_expires_at - now) < timedelta(minutes=10)


def _should_proactively_refresh(config):
    """Determine if we should proactively refresh before making an API call."""
    if not config.token_expires_at:
        return False
    return _is_token_expiring_soon(config.token_expires_at)


# ---------- Slack OIDC ----------

SLACK_API_BASE = "https://slack.com/api"
PKCE_COOKIE_NAME = "slack_pkce_verifier"
SLACK_OIDC_DISCOVERY_URL = "https://slack.com/.well-known/openid-configuration"
SLACK_JWKS_URL = "https://slack.com/openid/connect/keys"


def generate_pkce_pair():
    code_verifier = os.urandom(32).hex()
    code_challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    return code_verifier, code_challenge


def set_pkce_cookie(response: Response, verifier: str):
    is_dev = os.getenv("ENV") == "development"
    response.set_cookie(
        key=PKCE_COOKIE_NAME,
        value=verifier,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=300,
        path="/api/slack/oauth/callback",
    )


def clear_pkce_cookie(response: Response):
    response.delete_cookie(key=PKCE_COOKIE_NAME, path="/api/slack/oauth/callback")


def set_nonce_cookie(response: Response, nonce: str):
    is_dev = os.getenv("ENV") == "development"
    response.set_cookie(
        key="slack_nonce",
        value=nonce,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=300,
        path="/api/slack/oauth/callback",
    )


def clear_nonce_cookie(response: Response):
    response.delete_cookie(key="slack_nonce", path="/api/slack/oauth/callback")


def set_state_cookie(response: Response, state: str):
    is_dev = os.getenv("ENV") == "development"
    response.set_cookie(
        key=STATE_COOKIE_NAME,
        value=state,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=300,
        path="/api/slack/oauth/callback",
    )


def clear_state_cookie(response: Response):
    response.delete_cookie(key=STATE_COOKIE_NAME, path="/api/slack/oauth/callback")


_slack_jwks_cache = {}
_slack_jwks_timestamp = 0


async def get_slack_jwks():
    global _slack_jwks_cache, _slack_jwks_timestamp
    now = datetime.utcnow().timestamp()
    if _slack_jwks_cache and (now - _slack_jwks_timestamp) < 3600:
        logger.debug(
            "[SLACK OIDC] Using cached JWKS (age=%.1fs)", now - _slack_jwks_timestamp
        )
        return _slack_jwks_cache
    logger.info("[SLACK OIDC] Fetching JWKS from %s", SLACK_JWKS_URL)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(SLACK_JWKS_URL, timeout=10.0)
            resp.raise_for_status()
            jwks = resp.json()
            key_count = len(jwks.get("keys", []))
            _slack_jwks_cache = jwks
            _slack_jwks_timestamp = now
            logger.info(
                "[SLACK OIDC] JWKS fetched successfully | keys_count=%s", key_count
            )
            return jwks
    except httpx.HTTPStatusError as e:
        logger.error(
            "[SLACK OIDC] Failed to fetch JWKS | status=%s | response=%s | error=%s",
            e.response.status_code,
            e.response.text[:300],
            e,
        )
        return _slack_jwks_cache
    except Exception as e:
        logger.error("[SLACK OIDC] Failed to fetch JWKS | error=%s", e)
        return _slack_jwks_cache


def _get_jwk_key(jwks, kid):
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def _jwk_to_rsa_key(jwk):
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.backends import default_backend
    import base64

    n = int.from_bytes(base64.urlsafe_b64decode(jwk["n"] + "=="), "big")
    e = int.from_bytes(base64.urlsafe_b64decode(jwk["e"] + "=="), "big")
    public_numbers = rsa.RSAPublicNumbers(e, n)
    return public_numbers.public_key(default_backend())


def verify_slack_id_token(
    id_token: str, expected_audience: str, expected_nonce: str = None
):
    try:
        from jose import jwt as jose_jwt

        header = jose_jwt.get_unverified_header(id_token)
        kid = header.get("kid")
        alg = header.get("alg", "unknown")
        logger.info(
            "[SLACK OIDC] Verifying id_token | kid=%s | alg=%s | audience=%s",
            kid,
            alg,
            expected_audience,
        )
        jwks = _get_slack_jwks_sync()
        if not jwks:
            logger.error(
                "[SLACK OIDC] id_token verification failed: JWKS not available"
            )
            return None
        jwk = _get_jwk_key(jwks, kid)
        if not jwk:
            logger.error(
                "[SLACK OIDC] id_token verification failed: no matching JWK for kid=%s | available_kids=%s",
                kid,
                [k.get("kid") for k in jwks.get("keys", [])],
            )
            return None
        public_key = _jwk_to_rsa_key(jwk)
        payload = jose_jwt.decode(
            id_token,
            key=public_key,
            algorithms=["RS256"],
            audience=expected_audience,
            issuer="https://slack.com",
            options={
                "verify_exp": True,
                "verify_nbf": False,
                "verify_aud": True,
                "verify_iss": True,
            },
        )
        if expected_nonce and payload.get("nonce") != expected_nonce:
            logger.error(
                "[SLACK OIDC] Nonce mismatch: expected=%s, got=%s",
                expected_nonce,
                payload.get("nonce"),
            )
            return None
        logger.info(
            "[SLACK OIDC] id_token verified successfully | user=%s | team=%s",
            payload.get("email", payload.get("sub", "unknown")),
            payload.get("https://slack.com/team_id", "unknown"),
        )
        return payload
    except jose_jwt.ExpiredSignatureError:
        logger.error("[SLACK OIDC] id_token verification failed: token expired")
        return None
    except jose_jwt.JWTInvalidIssuer:
        logger.error("[SLACK OIDC] id_token verification failed: invalid issuer")
        return None
    except jose_jwt.JWTDecodeError as e:
        logger.error(
            "[SLACK OIDC] id_token verification failed: decode error | error=%s", e
        )
        return None
    except Exception as e:
        logger.error(
            "[SLACK OIDC] id_token verification failed: unexpected error | error=%s", e
        )
        return None


def _get_slack_jwks_sync():
    global _slack_jwks_cache, _slack_jwks_timestamp
    now = datetime.utcnow().timestamp()
    if _slack_jwks_cache and (now - _slack_jwks_timestamp) < 3600:
        return _slack_jwks_cache
    return _slack_jwks_cache


async def slack_oidc_exchange(code: str, redirect_uri: str, code_verifier: str = None):
    data = {
        "grant_type": "authorization_code",
        "client_id": SLACK_CLIENT_ID,
        "client_secret": SLACK_CLIENT_SECRET,
        "code": code,
        "redirect_uri": redirect_uri,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://slack.com/api/openid.connect.token",
            data=data,
            timeout=10.0,
        )
        return resp.json()


async def slack_get_userinfo(access_token: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://slack.com/api/openid.connect.userInfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
        return resp.json()


# ---------- Auth endpoints ----------


@app.post("/api/auth/login")
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user:
        logger.warning(
            "Login attempt with unknown email: %s | IP=%s",
            login_data.email,
            login_data.ip if hasattr(login_data, "ip") else "unknown",
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.password_hash:
        logger.warning(
            "Login attempt for user without password_hash: email=%s | user_id=%s | role=%s",
            login_data.email,
            user.id,
            user.role,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(login_data.password, user.password_hash):
        logger.warning(
            "Login failed: invalid password | email=%s | user_id=%s | IP=%s",
            login_data.email,
            user.id,
            login_data.ip if hasattr(login_data, "ip") else "unknown",
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.role.upper() not in VALID_ROLES:
        logger.info(
            "Login blocked: account pending approval | email=%s | user_id=%s | role=%s",
            login_data.email,
            user.id,
            user.role,
        )
        raise HTTPException(status_code=403, detail="Account pending approval")

    logger.info(
        "Login successful: email=%s | user_id=%s | role=%s | IP=%s",
        login_data.email,
        user.id,
        user.role,
        login_data.ip if hasattr(login_data, "ip") else "unknown",
    )
    session = create_session(user.id, db)

    token = create_jwt_token({"user_id": user.id, "role": user.role})
    json_response = JSONResponse(
        content={
            "access_token": token,
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "specialty": user.specialty,
                "initials": user.initials,
                "color": user.color,
            },
        }
    )
    set_session_cookie(json_response, session.session_token)
    return json_response


@app.post("/api/auth/slack-login")
async def slack_login(
    request: SlackLoginRequest,
    db: Session = Depends(get_db),
    response: Response = Response(),
):
    raise HTTPException(
        status_code=501,
        detail="Slack login via callback only. Use /api/auth/slack-auth-url to start the flow.",
    )


@app.get("/api/auth/slack-auth-url")
def get_slack_auth_url(request: Request = None):
    if not SLACK_CLIENT_ID:
        logger.error("Slack OIDC not configured: SLACK_CLIENT_ID is empty")
        raise HTTPException(status_code=500, detail="Slack OIDC not configured")
    nonce = os.urandom(16).hex()
    state = os.urandom(24).hex()
    params = {
        "client_id": SLACK_CLIENT_ID,
        "redirect_uri": SLACK_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
    }
    query = urllib.parse.urlencode(params)
    logger.info(
        "Slack auth URL generated | IP=%s | nonce=%s... | state=%s... | redirect_uri=%s",
        request.client.host if request and request.client else "unknown",
        nonce[:8],
        state[:8],
        SLACK_REDIRECT_URI,
    )
    redirect = RedirectResponse(
        url=f"https://slack.com/openid/connect/authorize?{query}", status_code=302
    )
    set_nonce_cookie(redirect, nonce)
    set_state_cookie(redirect, state)
    return redirect


FRONTEND_URL = os.getenv("FRONTEND_URL", "https://little-sparks-six.vercel.app").rstrip(
    "/"
)


@app.get("/api/slack/oauth/callback")
async def slack_oauth_callback(
    code: Optional[str] = None,
    error: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
    request: Request = None,
):
    if error:
        frontend_origin = FRONTEND_URL
        logger.warning(
            "[SLACK OIDC] Callback returned error: %s | redirecting to %s",
            error,
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?error={error}", status_code=302
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    if not code:
        frontend_origin = FRONTEND_URL
        logger.warning(
            "[SLACK OIDC] Callback received without authorization code | redirecting to %s",
            frontend_origin,
        )
        redirect = RedirectResponse(url=frontend_origin, status_code=302)
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    pkce_verifier = request.cookies.get(PKCE_COOKIE_NAME)
    if not pkce_verifier:
        logger.warning(
            "[SLACK OIDC] PKCE verifier cookie missing (user may have navigated directly to callback). code=%s",
            code[:10] if code else "None",
        )
    # if not pkce_verifier:
    #     redirect = RedirectResponse(url=f"{FRONTEND_URL}?error=pkce_missing", status_code=302)
    #     clear_pkce_cookie(redirect)
    #     clear_state_cookie(redirect)
    #     return redirect

    expected_state = request.cookies.get(STATE_COOKIE_NAME)
    if not expected_state or not state or expected_state != state:
        frontend_origin = FRONTEND_URL
        logger.error(
            "[SLACK OIDC] State mismatch - expected=%s, received=%s | IP=%s | User-Agent=%s | redirecting to %s",
            expected_state,
            state,
            request.client.host if request.client else "unknown",
            request.headers.get("user-agent", "unknown") if request else "unknown",
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?error=state_mismatch", status_code=302
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    logger.info(
        "[SLACK OIDC] Starting token exchange | code=%s... | PKCE=%s",
        code[:10] if code else "None",
        "present" if pkce_verifier else "missing",
    )
    token_data = await slack_oidc_exchange(code, SLACK_REDIRECT_URI, pkce_verifier)
    if not token_data.get("ok"):
        frontend_origin = FRONTEND_URL
        logger.error(
            "[SLACK OIDC] Token exchange FAILED | status=%s | error=%s | raw_response=%s | redirecting to %s",
            "N/A (non-JSON)" if not isinstance(token_data, dict) else "error",
            token_data.get("error", "unknown"),
            json.dumps(token_data)[:500],
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?error=slack_token_exchange_failed&reason={token_data.get('error', 'unknown')}",
            status_code=302,
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    access_token = token_data.get("access_token", "")
    logger.info(
        "[SLACK OIDC] Token exchange successful | access_token=%s... | token_data_ok=%s",
        access_token[:10] if access_token else "None",
        True,
    )

    logger.info(
        "[SLACK OIDC] Fetching user info with access_token=%s...",
        access_token[:10] if access_token else "None",
    )
    user_info = await slack_get_userinfo(access_token)
    if not user_info.get("ok"):
        frontend_origin = FRONTEND_URL
        logger.error(
            "[SLACK OIDC] User info fetch FAILED | response=%s | redirecting to %s",
            json.dumps(user_info)[:500],
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?error=slack_userinfo_failed", status_code=302
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    email = user_info.get("email", "")
    name = user_info.get("name", email.split("@")[0])
    slack_user_id = user_info.get("https://slack.com/user_id", "")
    slack_team_id = user_info.get("https://slack.com/team_id", "")
    logger.info(
        "[SLACK OIDC] User info retrieved | email=%s | slack_user_id=%s | slack_team_id=%s",
        email,
        slack_user_id,
        slack_team_id,
    )

    if SLACK_TEAM_ID and slack_team_id != SLACK_TEAM_ID:
        frontend_origin = FRONTEND_URL
        logger.warning(
            "[SLACK OIDC] Team ID mismatch | expected=%s | got=%s | email=%s | redirecting to %s",
            SLACK_TEAM_ID,
            slack_team_id,
            email,
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?error=not_workspace_member", status_code=302
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect

    existing_user = (
        db.query(User)
        .filter((User.email == email) | (User.slack_user_id == slack_user_id))
        .first()
    )

    if existing_user:
        if existing_user.role.upper() not in {r.upper() for r in VALID_ROLES}:
            frontend_origin = FRONTEND_URL
            logger.info(
                "[SLACK OIDC] Existing user pending approval | email=%s | user_id=%s | role=%s | redirecting to %s",
                email,
                existing_user.id,
                existing_user.role,
                frontend_origin,
            )
            redirect = RedirectResponse(
                url=f"{frontend_origin}?error=pending_approval", status_code=302
            )
            clear_pkce_cookie(redirect)
            clear_state_cookie(redirect)
            return redirect
        logger.info(
            "[SLACK OIDC] Existing user logged in | user_id=%s | email=%s | role=%s",
            existing_user.id,
            email,
            existing_user.role,
        )
        session = create_session(existing_user.id, db)
        frontend_origin = FRONTEND_URL
        redirect = RedirectResponse(
            url=f"{frontend_origin}?slack_login=success", status_code=302
        )
        set_session_cookie(redirect, session.session_token)
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect
    else:
        frontend_origin = FRONTEND_URL
        pending = User(
            name=name,
            email=email,
            password_hash=None,
            role="PENDING",
            slack_user_id=slack_user_id,
            slack_team_id=slack_team_id,
            requested_role="DESIGNER",
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)
        logger.info(
            "[SLACK OIDC] New user created and pending approval | email=%s | slack_user_id=%s | redirecting to %s",
            email,
            slack_user_id,
            frontend_origin,
        )
        redirect = RedirectResponse(
            url=f"{frontend_origin}?slack_pending=1", status_code=302
        )
        clear_pkce_cookie(redirect)
        clear_state_cookie(redirect)
        return redirect


@app.get("/api/auth/logout")
def logout(request: Request = None, response: Response = None):
    logger.info(
        "Logout requested | IP=%s | User-Agent=%s",
        request.client.host if request and request.client else "unknown",
        request.headers.get("user-agent", "unknown") if request else "unknown",
    )
    clear_session_cookie(response)
    return {"message": "Logged out"}


@app.get("/api/auth/me")
def get_me(user: Optional[User] = Depends(get_current_user)):
    if not user:
        return None
    return UserResponse.model_validate(user)


# ---------- Admin: Approve users ----------


@app.post("/api/admin/users/approve")
def approve_user(
    data: ApproveUserRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    target = (
        db.query(User).filter(User.id == data.user_id, User.role == "PENDING").first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Pending user not found")
    if data.role not in VALID_ROLES - {"PENDING"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    target.role = data.role
    db.commit()
    db.refresh(target)
    return UserResponse.model_validate(target)


@app.get("/api/admin/pending-users", response_model=List[PendingUserResponse])
def get_pending_users(
    db: Session = Depends(get_db), user: User = Depends(require_admin)
):
    pending = db.query(User).filter(User.role == "PENDING").all()
    return [PendingUserResponse.model_validate(p) for p in pending]


# ---------- Dashboard ----------


@app.get("/api/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    projects = get_user_owned_project_query(db, user).all()
    today = datetime.now().strftime("%Y-%m-%d")
    return DashboardStats(
        active_projects=len(projects),
        on_time=sum(1 for p in projects if p.status == "ON_TRACK"),
        completed=sum(1 for p in projects if p.status == "COMPLETED"),
        delayed=sum(1 for p in projects if p.status == "DELAYED"),
    )


@app.get("/api/dashboard/recent-projects", response_model=List[RecentProject])
def recent_projects(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    projects = (
        get_user_owned_project_query(db, user)
        .order_by(Project.created_at.desc())
        .limit(5)
        .all()
    )
    result = []
    for p in projects:
        designer = db.query(User).filter(User.id == p.assigned_designer_id).first()
        result.append(
            RecentProject(
                id=p.id,
                name=p.name,
                assigned_designer=designer.name if designer else "Unassigned",
                stage_index=p.stage_index,
                status=p.status,
            )
        )
    return result


@app.get("/api/dashboard/upcoming-deadlines", response_model=List[UpcomingDeadline])
def upcoming_deadlines(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    today = datetime.now().strftime("%Y-%m-%d")
    projects = (
        get_user_owned_project_query(db, user)
        .filter(Project.deadline >= today)
        .order_by(Project.deadline.asc())
        .limit(5)
        .all()
    )
    result = []
    today_dt = datetime.now()
    for p in projects:
        deadline_dt = datetime.strptime(p.deadline, "%Y-%m-%d")
        days_left = (deadline_dt - today_dt).days
        designer = db.query(User).filter(User.id == p.assigned_designer_id).first()
        result.append(
            UpcomingDeadline(
                project_id=p.id,
                project_name=p.name,
                assigned_designer=designer.name if designer else "Unassigned",
                deadline=p.deadline,
                days_left=days_left,
            )
        )
    return result


# ---------- Projects ----------


@app.get("/api/projects", response_model=List[ProjectResponse])
def get_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = get_user_owned_project_query(db, user).all()
    result = []
    for p in projects:
        phases = (
            db.query(Phase)
            .filter(Phase.project_id == p.id)
            .order_by(Phase.stage_index)
            .all()
        )
        managers = (
            db.query(User)
            .join(ProjectManager)
            .filter(ProjectManager.project_id == p.id)
            .all()
        )
        result.append(
            ProjectResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                assigned_designer_id=p.assigned_designer_id,
                stage_index=p.stage_index,
                progress=p.progress,
                deadline=p.deadline,
                start_date=p.start_date,
                status=p.status,
                manager_notes=p.manager_notes,
                slack_channel_id=p.slack_channel_id or "",
                slack_channel_name=p.slack_channel_name or "",
                created_by_user_id=p.created_by_user_id,
                phases=[PhaseResponse.model_validate(ph) for ph in phases],
                managers=[ProjectManagerResponse.model_validate(u) for u in managers],
            )
        )
    return result


@app.get("/api/projects/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access projects")
    if user.role.upper() == "MANAGER":
        is_creator = project.created_by_user_id == user.id
        is_assigned = (
            db.query(ProjectManager)
            .filter(
                ProjectManager.project_id == project_id,
                ProjectManager.manager_id == user.id,
            )
            .first()
            is not None
        )
        if not is_creator and not is_assigned:
            raise HTTPException(
                status_code=403, detail="You can only access your own projects"
            )
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    managers = (
        db.query(User)
        .join(ProjectManager)
        .filter(ProjectManager.project_id == project_id)
        .all()
    )
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        assigned_designer_id=project.assigned_designer_id,
        created_by_user_id=project.created_by_user_id,
        stage_index=project.stage_index,
        progress=project.progress,
        deadline=project.deadline,
        start_date=project.start_date,
        status=project.status,
        manager_notes=project.manager_notes,
        slack_channel_id=project.slack_channel_id or "",
        slack_channel_name=project.slack_channel_name or "",
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
        managers=[ProjectManagerResponse.model_validate(u) for u in managers],
    )


@app.post("/api/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot create projects")

    if datetime.strptime(data.deadline, "%Y-%m-%d") < datetime.strptime(
        data.start_date, "%Y-%m-%d"
    ):
        raise HTTPException(
            status_code=400,
            detail="Expected Completion date cannot be before Start Date",
        )

    phase_list = sorted(data.phases, key=lambda x: x.stage_index)
    for i, phase in enumerate(phase_list):
        if not phase.deadline:
            phase.deadline = data.deadline
        if i == 0 and datetime.strptime(phase.deadline, "%Y-%m-%d") < datetime.strptime(
            data.start_date, "%Y-%m-%d"
        ):
            raise HTTPException(
                status_code=400,
                detail="Phase 1 deadline cannot be before the Start Date",
            )
        if i > 0 and datetime.strptime(phase.deadline, "%Y-%m-%d") < datetime.strptime(
            phase_list[i - 1].deadline, "%Y-%m-%d"
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Phase {phase.stage_index + 1} deadline cannot be before Phase {phase.stage_index} deadline",
            )

    project = Project(
        name=data.name,
        description=data.description,
        assigned_designer_id=data.assigned_designer_id,
        created_by_user_id=user.id,
        start_date=data.start_date,
        deadline=data.deadline,
        manager_notes=data.manager_notes,
    )
    db.add(project)
    db.flush()

    # Add managers to project
    manager_ids = data.manager_ids or []
    if user.id not in manager_ids:
        manager_ids.append(user.id)
    for mid in manager_ids:
        pm = ProjectManager(project_id=project.id, manager_id=mid)
        db.add(pm)

    for phase_data in phase_list:
        phase = Phase(
            project_id=project.id,
            stage_index=phase_data.stage_index,
            deadline=phase_data.deadline,
        )
        db.add(phase)

    db.commit()
    db.refresh(project)

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project.id)
        .order_by(Phase.stage_index)
        .all()
    )

    from fastapi import BackgroundTasks

    async def _notify():
        with SessionLocal() as bg_db:
            try:
                await notify_project_created(
                    bg_db, project.id, user.slack_user_id, user.role.upper()
                )
            except Exception:
                pass

    await _notify()

    managers = (
        db.query(User)
        .join(ProjectManager)
        .filter(ProjectManager.project_id == project.id)
        .all()
    )

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        assigned_designer_id=project.assigned_designer_id,
        created_by_user_id=project.created_by_user_id,
        stage_index=project.stage_index,
        progress=project.progress,
        deadline=project.deadline,
        start_date=project.start_date,
        status=project.status,
        manager_notes=project.manager_notes,
        slack_channel_id=project.slack_channel_id or "",
        slack_channel_name=project.slack_channel_name or "",
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
        managers=[ProjectManagerResponse.model_validate(u) for u in managers],
    )


@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot modify projects")
    # Check if user is the creator OR a manager assigned to this project
    is_creator = project.created_by_user_id == user.id
    is_manager = (
        db.query(ProjectManager)
        .filter(
            ProjectManager.project_id == project_id,
            ProjectManager.manager_id == user.id,
        )
        .first()
        is not None
    )
    if not is_creator and not is_manager:
        raise HTTPException(
            status_code=403, detail="You can only modify your own projects"
        )

    changes = []
    if data.name is not None and data.name != project.name:
        changes.append(f"Name: {project.name} → {data.name}")
        project.name = data.name
    if data.description is not None and data.description != project.description:
        changes.append(f"Description updated")
        project.description = data.description
    if data.deadline is not None and data.deadline != project.deadline:
        changes.append(f"Deadline: {project.deadline} → {data.deadline}")
        project.deadline = data.deadline
    if data.manager_notes is not None and data.manager_notes != project.manager_notes:
        changes.append(f"Manager notes updated")
        project.manager_notes = data.manager_notes
    if data.delay_reason is not None:
        # Update delay_reason on the current active phase
        current_phase = (
            db.query(Phase)
            .filter(Phase.project_id == project_id, Phase.stage_index == project.stage_index)
            .first()
        )
        if current_phase:
            old_reason = current_phase.delay_reason or ""
            if old_reason and old_reason not in ("On time", ""):
                current_phase.delay_reason = f"{old_reason} (Revised: {data.delay_reason})"
            else:
                current_phase.delay_reason = data.delay_reason
            changes.append(f"Delay reason updated")
        else:
            # No phase found, just log it
            pass
    if (
        data.slack_channel_id is not None
        and data.slack_channel_id != project.slack_channel_id
    ):
        changes.append(f"Slack channel ID updated")
        project.slack_channel_id = data.slack_channel_id
    if (
        data.slack_channel_name is not None
        and data.slack_channel_name != project.slack_channel_name
    ):
        changes.append(f"Slack channel name updated")
        project.slack_channel_name = data.slack_channel_name

    # Handle manager_ids update
    if data.manager_ids is not None:
        # Remove existing manager associations
        db.query(ProjectManager).filter(
            ProjectManager.project_id == project_id
        ).delete()
        # Add new ones
        if user.id not in data.manager_ids:
            data.manager_ids.append(user.id)
        for mid in data.manager_ids:
            pm = ProjectManager(project_id=project_id, manager_id=mid)
            db.add(pm)
        changes.append(f"Manager assignments updated")
        db.commit()

    if changes:
        db.commit()
        db.refresh(project)

        designer = (
            db.query(User).filter(User.id == project.assigned_designer_id).first()
        )
        designer_name = designer.name if designer else "Unassigned"
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        current_stage = _get_current_stage_name(project.stage_index)

        async def _notify_update():
            with SessionLocal() as bg_db:
                try:
                    await notify_project_updated(bg_db, project_id)
                except Exception:
                    pass

        await _notify_update()
    else:
        db.commit()
        db.refresh(project)

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    managers = (
        db.query(User)
        .join(ProjectManager)
        .filter(ProjectManager.project_id == project_id)
        .all()
    )

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        assigned_designer_id=project.assigned_designer_id,
        stage_index=project.stage_index,
        progress=project.progress,
        deadline=project.deadline,
        start_date=project.start_date,
        status=project.status,
        manager_notes=project.manager_notes,
        slack_channel_id=project.slack_channel_id or "",
        slack_channel_name=project.slack_channel_name or "",
        created_by_user_id=project.created_by_user_id,
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
        managers=[ProjectManagerResponse.model_validate(u) for u in managers],
    )


@app.post("/api/projects/{project_id}/stages/{stage_index}/complete")
async def complete_stage(
    project_id: int,
    stage_index: int,
    delay_reason: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot complete stages")
    is_creator = project.created_by_user_id == user.id
    is_assigned = (
        db.query(ProjectManager)
        .filter(
            ProjectManager.project_id == project_id,
            ProjectManager.manager_id == user.id,
        )
        .first()
        is not None
    )
    if not is_creator and not is_assigned:
        raise HTTPException(
            status_code=403, detail="You can only modify your own projects"
        )

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    if stage_index >= len(phases):
        raise HTTPException(status_code=400, detail="Stage not found")

    if stage_index > 0:
        prev_phase = phases[stage_index - 1]
        if not prev_phase.completed_at:
            raise HTTPException(
                status_code=400, detail="Complete the previous stage first!"
            )

    if delay_reason:
        old_reason = phases[stage_index].delay_reason or ""
        if old_reason and old_reason not in ("On time", ""):
            phases[stage_index].delay_reason = f"{old_reason} (Revised: {delay_reason})"
        else:
            phases[stage_index].delay_reason = delay_reason

    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    phases[stage_index].completed_at = now

    total = len(phases)
    completed = sum(1 for ph in phases if ph.completed_at)
    project.progress = round((completed / total) * 100)
    project.stage_index = min(stage_index + 1, total - 1)

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    if project.progress == 100:
        project.status = "COMPLETED"
    elif project.deadline < today_str:
        project.status = "DELAYED"
    else:
        project.status = "ON_TRACK"

    db.commit()

    designer = db.query(User).filter(User.id == project.assigned_designer_id).first()
    designer_name = designer.name if designer else "Unassigned"
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    completed_stage_name = _get_current_stage_name(stage_index)
    next_stage_name = _get_current_stage_name(project.stage_index)

    if project.progress == 100:
        notify = (
            f"🎉 *Project Completed!*\n\n"
            f"*{project.name}*\n\n"
            f"All {total} stages have been completed!\n"
            f"👤 Designer: {designer_name}\n"
            f"📊 Final Progress: 100%\n\n"
            f"Great work! 🙌"
        )
    else:
        notify = (
            f"✅ *Stage Complete!*\n\n"
            f"Stage completed: *{completed_stage_name}*\n\n"
            f"📦 Project: {project.name}\n"
            f"👤 Designer: {designer_name}\n"
            f"📊 Progress: {project.progress}%\n"
            f"🔄 Next Stage: {next_stage_name}\n\n"
            f"Reply with 'stage update' for more details."
        )

    async def _notify_stage():
        with SessionLocal() as bg_db:
            try:
                await notify_stage_completed(bg_db, project_id, stage_index)
            except Exception:
                pass

    await _notify_stage()

    return {"message": "Stage marked complete"}


@app.post("/api/projects/{project_id}/stages/{stage_index}/unmark")
async def unmark_stage(
    project_id: int,
    stage_index: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot unmark stages")

    is_creator = project.created_by_user_id == user.id
    is_assigned = (
        db.query(ProjectManager)
        .filter(
            ProjectManager.project_id == project_id,
            ProjectManager.manager_id == user.id,
        )
        .first()
        is not None
    )
    if not is_creator and not is_assigned:
        raise HTTPException(
            status_code=403, detail="You can only modify your own projects"
        )

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    if stage_index >= len(phases):
        raise HTTPException(status_code=400, detail="Stage not found")

    phases[stage_index].completed_at = None
    project.stage_index = stage_index

    total = len(phases)
    completed = sum(1 for ph in phases if ph.completed_at)
    project.progress = round((completed / total) * 100)

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    if project.progress == 100:
        project.status = "COMPLETED"
    elif project.deadline < today_str:
        project.status = "DELAYED"
    else:
        project.status = "ON_TRACK"

    db.commit()

    designer = db.query(User).filter(User.id == project.assigned_designer_id).first()
    designer_name = designer.name if designer else "Unassigned"
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    unmarked_stage_name = _get_current_stage_name(stage_index)

    notify = (
        f"⏪ *Stage Unmarked*\n\n"
        f"Stage unmarked: *{unmarked_stage_name}*\n\n"
        f"📦 Project: {project.name}\n"
        f"👤 Designer: {designer_name}\n"
        f"📊 Progress: {project.progress}%\n"
        f"🔄 Current Stage: {unmarked_stage_name}\n\n"
        f"Please complete this stage to continue."
    )

    async def _notify_unmark():
        with SessionLocal() as bg_db:
            try:
                await notify_stage_unmarked(bg_db, project_id, stage_index)
            except Exception:
                pass

    await _notify_unmark()

    return {"message": "Stage unmarked"}


@app.post("/api/projects/{project_id}/phases/{stage_index}/assign-designers")
async def assign_designers_to_phase(
    project_id: int,
    stage_index: int,
    data: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot assign designers")

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    if stage_index >= len(phases):
        raise HTTPException(status_code=400, detail="Stage not found")

    designer_ids = data.get("designer_ids", [])
    phases[stage_index].assigned_designer_ids = designer_ids
    db.commit()

    if project.slack_channel_id and designer_ids:
        slack_user_ids = []
        for did in designer_ids:
            d = db.query(User).filter(User.id == did).first()
            if d and d.slack_user_id:
                slack_user_ids.append(d.slack_user_id)
        if slack_user_ids:
            await invite_users_to_channel(db, project.slack_channel_id, slack_user_ids)

        async def _notify_assign():
            with SessionLocal() as bg_db:
                try:
                    await notify_designers_assigned(
                        bg_db, project_id, stage_index, designer_ids
                    )
                except Exception:
                    pass

        await _notify_assign()

    return {"message": "Designers assigned", "designer_ids": designer_ids}


# ---------- Designers ----------


@app.get("/api/designers", response_model=List[UserResponse])
def get_designers(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    users = db.query(User).filter(User.role == "DESIGNER").all()
    return [UserResponse.model_validate(u) for u in users]


@app.get("/api/managers", response_model=List[UserResponse])
def get_managers(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    users = db.query(User).filter(User.role.in_(["MANAGER", "ADMIN"])).all()
    return [UserResponse.model_validate(u) for u in users]


@app.post("/api/designers", response_model=UserResponse, status_code=201)
def create_designer(
    data: UserCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already exists")

    colors = [
        "bg-blue-500",
        "bg-purple-500",
        "bg-teal-500",
        "bg-pink-500",
        "bg-indigo-500",
        "bg-orange-500",
        "bg-green-500",
        "bg-red-500",
    ]
    initials = " ".join([n[0] for n in data.name.split() if n]).upper()[:2]
    color = colors[
        len(db.query(User).filter(User.role == "DESIGNER").all()) % len(colors)
    ]

    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="DESIGNER",
        specialty=data.specialty,
        initials=initials,
        color=color,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@app.delete("/api/designers/{designer_id}")
def delete_designer(
    designer_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user.role.upper() == "DESIGNER":
        raise HTTPException(
            status_code=403, detail="Designers cannot delete other designers"
        )
    designer = db.query(User).filter(User.id == designer_id).first()
    if not designer:
        raise HTTPException(status_code=404, detail="Designer not found")

    projects = (
        db.query(Project).filter(Project.assigned_designer_id == designer_id).all()
    )
    if projects:
        project_names = [p.name for p in projects]
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete designer. Reassign projects first: {', '.join(project_names)}",
        )

    db.delete(designer)
    db.commit()
    return {"message": "Designer removed"}


# ---------- Slack Integration ----------


def _get_project_details(db, project_id):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None, None, None
    designer = (
        db.query(User).filter(User.id == project.assigned_designer_id).first()
        if project.assigned_designer_id
        else None
    )
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    return project, designer, phases


def _get_current_stage_name(stage_index):
    stage_names = [
        "Lock Concept",
        "Lock UX features",
        "Lock MRP",
        "Lock graphics theme",
        "Lock Production feasibility",
        "Lock Procurement",
        "Lock IM",
        "Lock CCP",
        "Final Handover",
    ]
    return (
        stage_names[stage_index] if stage_index < len(stage_names) else "Unknown Stage"
    )


def get_slack_config(db):
    config = db.query(SlackConfig).first()
    return config


def verify_slack_signature(timestamp, signature, body, signing_secret):
    if not signing_secret or not signature or not timestamp:
        logger.warning(
            "[SLACK WEBHOOK] Missing signing_secret, signature, or timestamp for verification"
        )
        return False
    try:
        ts_int = int(timestamp)
        current_ts = int(datetime.utcnow().timestamp())
        diff = abs(current_ts - ts_int)
        if diff > 60 * 5:
            logger.warning(
                "[SLACK WEBHOOK] Request timestamp expired | diff=%ss",
                diff,
            )
            return False
        sig_b64 = (
            "v0="
            + hmac.new(
                signing_secret.encode(),
                f"v0:{timestamp}:{body}".encode(),
                hashlib_lib.sha256,
            ).hexdigest()
        )
        match = hmac.compare_digest(sig_b64, signature)
        if not match:
            logger.error(
                "[SLACK WEBHOOK] Signature verification failed | expected=%s... | got=%s...",
                sig_b64[:20],
                signature[:20] if signature else "None",
            )
        return match
    except Exception as e:
        logger.error(
            "[SLACK WEBHOOK] Error during signature verification: %s", e
        )
        return False


async def slack_api_call(db, endpoint, data=None):
    config = get_slack_config(db)
    if not config:
        logger.warning("[SLACK API] No Slack config found | endpoint=%s", endpoint)
        raise RuntimeError(f"Slack not configured: no config found for {endpoint}")

    # Proactively refresh if token is expiring soon
    if _should_proactively_refresh(config):
        logger.info("[SLACK API] Proactively refreshing token before %s call", endpoint)
        success, err = await refresh_slack_token(db)
        if not success:
            logger.warning(
                "[SLACK API] Proactive refresh failed: %s | proceeding with existing token",
                err,
            )

    bot_token = (
        decrypt_token(config.bot_token) if config.encrypted else config.bot_token
    )
    if not bot_token:
        logger.error(
            "[SLACK API] Failed to decrypt bot token | config_id=%s | encrypted=%s | endpoint=%s",
            config.id,
            config.encrypted,
            endpoint,
        )
        raise RuntimeError(f"Slack token unavailable for {endpoint}")
    headers = {
        "Authorization": f"Bearer {bot_token}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient() as client:
            logger.debug(
                "[SLACK API] Calling %s | data_keys=%s",
                endpoint,
                list(data.keys()) if data else "None",
            )
            response = await client.post(
                f"{SLACK_API_BASE}/{endpoint}",
                headers=headers,
                json=data or {},
                timeout=10.0,
            )
            logger.debug(
                "[SLACK API] %s response | status=%s | ok=%s",
                endpoint,
                response.status_code,
                response.json().get("ok") if response.status_code == 200 else "N/A",
            )
            result = response.json()
            if not result.get("ok"):
                error_code = result.get("error", "")
                logger.warning(
                    "[SLACK API] %s returned error | status=%s | error=%s | response=%s",
                    endpoint,
                    response.status_code,
                    error_code,
                    json.dumps(result)[:500],
                )
                # Retry once with token refresh for auth-related errors
                if error_code in ("invalid_auth", "token_expired", "account_inactive"):
                    logger.info(
                        "[SLACK API] Auth error detected (%s), attempting token refresh and retry",
                        error_code,
                    )
                    success, err = await refresh_slack_token(db)
                    if success:
                        # Retry with new token
                        new_token = (
                            decrypt_token(config.bot_token)
                            if config.encrypted
                            else config.bot_token
                        )
                        if new_token:
                            headers["Authorization"] = f"Bearer {new_token}"
                            async with httpx.AsyncClient() as retry_client:
                                retry_resp = await retry_client.post(
                                    f"{SLACK_API_BASE}/{endpoint}",
                                    headers=headers,
                                    json=data or {},
                                    timeout=10.0,
                                )
                                retry_result = retry_resp.json()
                                if retry_result.get("ok"):
                                    logger.info(
                                        "[SLACK API] Retry after token refresh succeeded for %s",
                                        endpoint,
                                    )
                                    return retry_result
                                else:
                                    logger.error(
                                        "[SLACK API] Retry still failed after token refresh | error=%s",
                                        retry_result.get("error"),
                                    )
                    else:
                        logger.error(
                            "[SLACK API] Token refresh failed: %s | cannot retry",
                            err,
                        )
                return result
            return result
    except httpx.HTTPStatusError as e:
        logger.error(
            "[SLACK API] %s HTTP error | status=%s | response=%s | error=%s",
            endpoint,
            e.response.status_code,
            e.response.text[:300],
            e,
        )
        return None
    except Exception as e:
        logger.error("[SLACK API] %s unexpected error | error=%s", endpoint, e)
        return None


async def resolve_slack_user_id_by_email(db, email):
    """Look up a Slack user ID by email using users.lookup_by_email API.
    Returns the slack_user_id string, or empty string if not found."""
    if not email:
        return ""
    result = await slack_api_call(db, "users.lookup_by_email", {"email": email})
    if result and result.get("ok") and result.get("user"):
        user_id = result["user"].get("id", "")
        logger.info(
            "[SLACK LOOKUP] Found Slack user by email | email=%s | slack_user_id=%s",
            email,
            user_id,
        )
        return user_id
    logger.warning(
        "[SLACK LOOKUP] Could not find Slack user by email | email=%s | result_ok=%s",
        email,
        result.get("ok") if result else False,
    )
    return ""


async def invite_users_to_channel(db, channel_id, slack_user_ids):
    """Invite Slack users to a channel. Skips empty IDs silently."""
    valid = [uid for uid in slack_user_ids if uid]
    if not valid:
        logger.warning(
            "[SLACK INVITE] No valid user IDs to invite | channel=%s | raw_ids=%s",
            channel_id,
            slack_user_ids,
        )
        return
    result = await slack_api_call(
        db, "conversations.invite", {"channel": channel_id, "users": ",".join(valid)}
    )
    if result is None:
        logger.error(
            "[SLACK INVITE] slack_api_call returned None | channel=%s | users=%s",
            channel_id,
            valid,
        )
    elif not result.get("ok"):
        logger.error(
            "[SLACK INVITE] Invite failed | channel=%s | users=%s | error=%s",
            channel_id,
            valid,
            result.get("error"),
        )
    else:
        logger.info(
            "[SLACK INVITE] Users invited successfully | channel=%s | users=%s",
            channel_id,
            valid,
        )


async def verify_channel(db, channel_id):
    """Verify a Slack channel still exists and is not archived.

    Returns a dict with:
        status: 'connected' | 'archived' | 'not_found' | 'unknown'
        channel_name: str | None
        error: str | None
    """
    if not channel_id:
        return {
            "status": "not_found",
            "channel_name": None,
            "error": "No channel_id provided",
        }

    result = await slack_api_call(db, "conversations.info", {"channel": channel_id})

    if result is None:
        return {
            "status": "unknown",
            "channel_name": None,
            "error": "Slack API unreachable",
        }

    if not result.get("ok"):
        error_code = result.get("error", "")
        if error_code in ("channel_not_found", "invalid_channel_id", "not_in_channel"):
            return {"status": "not_found", "channel_name": None, "error": error_code}
        return {"status": "unknown", "channel_name": None, "error": error_code}

    channel = result.get("channel", {})
    if channel.get("is_archived"):
        return {
            "status": "archived",
            "channel_name": channel.get("name"),
            "error": "Channel is archived",
        }

    return {"status": "connected", "channel_name": channel.get("name"), "error": None}


async def send_slack_notification(db, project_id, text, blocks=None, channel_id=None):
    config = get_slack_config(db)
    if not config:
        return
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    target_channel = channel_id or project.slack_channel_id
    if not target_channel:
        return
    data = {"channel": target_channel, "text": text, "blocks": blocks or []}
    result = await slack_api_call(db, "chat.postMessage", data)
    if result and result.get("ok"):
        activity = SlackActivity(
            project_id=project_id,
            channel_id=target_channel,
            message_ts=result["ts"],
            action_type="notification",
            user_id="",
            user_name="Smartivity Bot",
            payload=result,
        )
        db.add(activity)
        db.commit()


async def notify_project_created(
    db, project_id, manager_slack_user_id="", user_role=""
):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    config = get_slack_config(db)
    if not config:
        return
    if not project.slack_channel_id:
        channel_name = f"project-{project.name.lower().replace(' ', '-')}"
        result = await slack_api_call(
            db, "conversations.create", {"name": channel_name, "is_private": False}
        )
        if result and result.get("ok"):
            project.slack_channel_id = result["channel"]["id"]
            project.slack_channel_name = channel_name
            db.commit()
            db.refresh(project)
            if user_role == "ADMIN":
                await invite_users_to_channel(
                    db, result["channel"]["id"], [manager_slack_user_id]
                )
            else:
                designer_slack_id = designer.slack_user_id if designer else ""
                if not designer_slack_id and designer:
                    designer_slack_id = await resolve_slack_user_id_by_email(
                        db, designer.email
                    )
                await invite_users_to_channel(
                    db,
                    result["channel"]["id"],
                    [manager_slack_user_id, designer_slack_id],
                )
        else:
            return
    channel_id = project.slack_channel_id
    designer_name = designer.name if designer else "Unassigned"
    manager_name = "Admin"
    if user_role == "ADMIN" and manager_slack_user_id:
        manager_name = "Admin"
    stage_list = ""
    for i, phase in enumerate(phases):
        stage_list += f"  {i + 1}. *{phase.deadline}*\n"
    description_text = (
        project.description if project.description else "No description provided."
    )
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"📦 New Project Created: {project.name}",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*Why this channel?*\n"
                    f"This channel was created to coordinate work on *{project.name}*.\n"
                    f"All project updates, stage completions, and designer assignments will be posted here.\n\n"
                    f"*Project Details*\n"
                    f"📝 *Description:* {description_text}\n"
                    f"👤 *Assigned Designer:* {designer_name}\n"
                    f"👷 *Manager:* {manager_name}\n"
                    f"📅 *Start Date:* {project.start_date}\n"
                    f"📅 *Expected Completion:* {project.deadline}\n"
                    f"📊 *Status:* {project.status.replace('_', ' ')}"
                ),
            },
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Workflow — {len(phases)} Stages*\n\n{stage_list}",
            },
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📋 View Project"},
                    "action_id": "view_project",
                    "value": str(project.id),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Accept"},
                    "action_id": "accept_project",
                    "value": str(project.id),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "❓ Clarify"},
                    "action_id": "clarify_project",
                    "value": str(project.id),
                },
            ],
        },
    ]
    await send_slack_notification(
        db, project_id, f"📦 New project: {project.name}", blocks, channel_id
    )


async def send_stage_update_reminder(db, project_id, kind="manual", phase=None):
    """Post a Slack message to a project's channel asking the designer for an
    update on the *current* stage (read fresh from the DB each time, so it's
    always in sync with project.stage_index).

    kind: "daily"    -> automated 10AM daily check-in
          "deadline"  -> a phase's deadline is today
          "manual"    -> manager clicked "Send Reminder" in the app
    """
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return False
    config = get_slack_config(db)
    if not config or not project.slack_channel_id:
        return False

    current_phase = (
        phases[project.stage_index] if project.stage_index < len(phases) else None
    )
    stage_name = _get_current_stage_name(project.stage_index)
    designer_name = designer.name if designer else "Unassigned"
    designer_mention = (
        f"<@{designer.slack_user_id}>" if designer and designer.slack_user_id else designer_name
    )

    headers = {
        "daily": "☀️ Daily Update Check-in",
        "deadline": "⏰ Deadline Reminder",
        "manual": "🔔 Update Requested",
    }
    intros = {
        "daily": f"Good morning {designer_mention}! Here's your daily check-in for *{project.name}*.",
        "deadline": (
            f"{designer_mention}, today ({phase.deadline if phase else project.deadline}) "
            f"is the deadline for *{stage_name}* on *{project.name}*."
        ),
        "manual": f"{designer_mention}, the project manager is asking for an update on *{project.name}*.",
    }

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": headers.get(kind, "🔔 Update Requested")},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"{intros.get(kind, intros['manual'])}\n\n"
                    f"🔄 *Current Stage:* {stage_name}\n"
                    f"📊 *Progress:* {project.progress}%\n"
                    f"📅 *Stage Deadline:* {current_phase.deadline if current_phase else 'N/A'}\n\n"
                    f"Please share where things stand using the button below."
                ),
            },
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📊 Submit Report"},
                    "action_id": "submit_report",
                    "value": str(project.id),
                    "style": "primary",
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📝 Post Update"},
                    "action_id": "update_notes",
                    "value": str(project.id),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "⚠️ Report Delay"},
                    "action_id": "report_delay",
                    "value": str(project.id),
                },
            ],
        },
    ]
    fallback_text = f"{headers.get(kind, 'Update Requested')}: {project.name} — {stage_name}"
    await send_slack_notification(db, project_id, fallback_text, blocks, project.slack_channel_id)
    return True


async def notify_project_updated(db, project_id):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    config = get_slack_config(db)
    if not config:
        return
    if project.slack_channel_id:
        blocks = _build_project_card(project, designer, phases)
        await send_slack_notification(
            db,
            project_id,
            f"📝 Project updated: {project.name}",
            blocks,
            project.slack_channel_id,
        )


async def notify_stage_completed(db, project_id, stage_index):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    config = get_slack_config(db)
    if not config:
        return
    if project.slack_channel_id:
        completed_stage_name = _get_current_stage_name(stage_index)
        next_stage_name = _get_current_stage_name(project.stage_index)
        if project.progress == 100:
            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🎉 Project Completed!"},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f"*{project.name}*\n\n"
                            f"All {len(phases)} stages have been completed!\n"
                            f"👤 Designer: {designer.name if designer else 'Unassigned'}\n"
                            f"📊 Final Progress: 100%\n\n"
                            f"Great work! 🙌"
                        ),
                    },
                },
            ]
            await send_slack_notification(
                db,
                project_id,
                f"🎉 Project completed: {project.name}",
                blocks,
                project.slack_channel_id,
            )
        else:
            blocks = [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": f"✅ Stage Complete: {completed_stage_name}",
                    },
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f"📦 *Project:* {project.name}\n"
                            f"👤 *Designer:* {designer.name if designer else 'Unassigned'}\n"
                            f"📊 *Progress:* {project.progress}%\n"
                            f"🔄 *Next Stage:* {next_stage_name}\n"
                        ),
                    },
                },
                {"type": "divider"},
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "📊 Progress"},
                            "action_id": "view_progress",
                            "value": str(project.id),
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "📦 Project Info"},
                            "action_id": "view_project",
                            "value": str(project.id),
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "🔄 Stage Update"},
                            "action_id": "stage_update",
                            "value": str(project.id),
                        },
                    ],
                },
            ]
            await send_slack_notification(
                db,
                project_id,
                f"✅ Stage completed: {completed_stage_name}",
                blocks,
                project.slack_channel_id,
            )


async def notify_stage_unmarked(db, project_id, stage_index):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    config = get_slack_config(db)
    if not config:
        return
    if project.slack_channel_id:
        unmarked_stage_name = _get_current_stage_name(stage_index)
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"⏪ Stage Unmarked: {unmarked_stage_name}",
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"📦 *Project:* {project.name}\n"
                        f"👤 *Designer:* {designer.name if designer else 'Unassigned'}\n"
                        f"📊 *Progress:* {project.progress}%\n"
                        f"🔄 *Current Stage:* {unmarked_stage_name}\n\n"
                        f"Please complete this stage to continue."
                    ),
                },
            },
            {"type": "divider"},
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📊 Progress"},
                        "action_id": "view_progress",
                        "value": str(project.id),
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Complete Stage"},
                        "action_id": "complete_stage",
                        "value": str(stage_index),
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📦 Project Info"},
                        "action_id": "view_project",
                        "value": str(project.id),
                    },
                ],
            },
        ]
        await send_slack_notification(
            db,
            project_id,
            f"⏪ Stage unmarked: {unmarked_stage_name}",
            blocks,
            project.slack_channel_id,
        )


async def notify_designers_assigned(db, project_id, stage_index, designer_ids):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return
    config = get_slack_config(db)
    if not config:
        return
    if not project.slack_channel_id:
        return
    stage_name = _get_current_stage_name(stage_index)
    assigned_names = []
    for did in designer_ids:
        d = db.query(User).filter(User.id == did).first()
        if d:
            assigned_names.append(d.name)
    names_text = ", ".join(assigned_names) if assigned_names else "Unassigned"
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"👥 Designers Assigned: {stage_name}",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"📦 *Project:* {project.name}\n"
                    f"🔄 *Stage:* {stage_name}\n"
                    f"👤 *Assigned Designers:* {names_text}\n\n"
                    f"The assigned designers have been added to this channel."
                ),
            },
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📋 View Project"},
                    "action_id": "view_project",
                    "value": str(project.id),
                },
            ],
        },
    ]
    await send_slack_notification(
        db,
        project_id,
        f"👥 Designers assigned to {stage_name}: {project.name}",
        blocks,
        project.slack_channel_id,
    )


def _build_project_block(project, designer, phases):
    current_stage = _get_current_stage_name(project.stage_index)
    designer_name = designer.name if designer else "Unassigned"
    stages_completed = sum(1 for p in phases if p.completed_at)
    total_stages = len(phases)
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    days_left = (datetime.strptime(project.deadline, "%Y-%m-%d") - datetime.now()).days

    return {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": (
                f"*{project.name}*\n"
                f"👤 *Designer:* {designer_name}\n"
                f"📊 *Progress:* {project.progress}%\n"
                f"🔄 *Current Stage:* {current_stage}\n"
                f"📅 *Deadline:* {project.deadline} ({days_left} days left)\n"
                f"📌 *Status:* {project.status.replace('_', ' ')}\n"
                f"✅ *Stages:* {stages_completed}/{total_stages} completed"
            ),
        },
    }


def _build_project_attachment(project, designer, phases):
    blocks = [_build_project_block(project, designer, phases)]
    actions = [
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "✅ Complete Stage"},
            "action_id": "complete_stage",
            "value": str(project.stage_index),
        },
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "⚠️ Report Delay"},
            "action_id": "report_delay",
            "value": str(project.stage_index),
        },
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "📊 Progress"},
            "action_id": "view_progress",
            "value": str(project.id),
        },
    ]
    blocks.append({"type": "actions", "elements": actions})
    return blocks


def _build_project_card(project, designer, phases):
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📦 {project.name}"},
        },
        _build_project_block(project, designer, phases),
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Complete Stage"},
                    "action_id": "complete_stage",
                    "value": str(project.stage_index),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "⚠️ Report Delay"},
                    "action_id": "report_delay",
                    "value": str(project.stage_index),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📊 Progress"},
                    "action_id": "view_progress",
                    "value": str(project.id),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📝 Update Notes"},
                    "action_id": "update_notes",
                    "value": str(project.stage_index),
                },
            ],
        },
    ]
    return blocks


# ---------- Slack Config Endpoints ----------


@app.get("/api/slack/config", response_model=SlackConfigResponse)
def get_slack_config_endpoint(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role.upper() == "DESIGNER":
        raise HTTPException(
            status_code=403, detail="Designers cannot access Slack configuration"
        )
    config = get_slack_config(db)
    if not config:
        raise HTTPException(status_code=404, detail="Slack not configured")
    return SlackConfigResponse.model_validate(config)


@app.post("/api/slack/config", response_model=SlackConfigResponse, status_code=201)
def save_slack_config(
    data: SlackConfigCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = get_slack_config(db)
    if config:
        if data.bot_token:
            config.bot_token = encrypt_token(data.bot_token)
        if data.signing_secret:
            config.signing_secret = encrypt_token(data.signing_secret)
        config.encrypted = True
        if data.slack_team_id:
            config.slack_team_id = data.slack_team_id
        db.commit()
        db.refresh(config)
        return SlackConfigResponse.model_validate(config)
    else:
        config = SlackConfig(
            bot_token=encrypt_token(data.bot_token or ""),
            signing_secret=encrypt_token(data.signing_secret or ""),
            slack_team_id=data.slack_team_id,
            encrypted=True,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return SlackConfigResponse.model_validate(config)


@app.get("/api/slack/install")
def slack_install(user: User = Depends(require_admin)):
    """Starts the Slack App Install flow (oauth.v2.access) to obtain a bot token.
    This is separate from Login-with-Slack (OIDC) used for user sign-in."""
    if not SLACK_CLIENT_ID:
        logger.error(
            "[SLACK INSTALL] Slack app not configured: SLACK_CLIENT_ID is empty"
        )
        raise HTTPException(status_code=500, detail="Slack app not configured")
    state = os.urandom(24).hex()
    params = {
        "client_id": SLACK_CLIENT_ID,
        "scope": SLACK_BOT_SCOPES,
        "redirect_uri": SLACK_BOT_REDIRECT_URI,
        "state": state,
    }
    query = urllib.parse.urlencode(params)
    logger.info(
        "[SLACK INSTALL] Install flow started | user_id=%s | user=%s | state=%s... | redirect_uri=%s | scopes=%s",
        user.id,
        user.name,
        state[:8],
        SLACK_BOT_REDIRECT_URI,
        SLACK_BOT_SCOPES,
    )
    redirect = RedirectResponse(
        url=f"https://slack.com/oauth/v2/authorize?{query}", status_code=302
    )
    is_dev = os.getenv("ENV") == "development"
    redirect.set_cookie(
        key=INSTALL_STATE_COOKIE,
        value=state,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=300,
        path="/api/slack/install/callback",
    )
    return redirect


@app.get("/api/slack/install/callback")
async def slack_install_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    request: Request = None,
    db: Session = Depends(get_db),
):
    if error:
        logger.warning(
            "[SLACK INSTALL] Install callback returned error: %s | IP=%s",
            error,
            request.client.host if request and request.client else "unknown",
        )
        return RedirectResponse(
            url=f"{FRONTEND_URL}?slack_install_error={error}", status_code=302
        )
    if not code:
        logger.warning(
            "[SLACK INSTALL] Install callback received without authorization code | IP=%s",
            request.client.host if request and request.client else "unknown",
        )
        return RedirectResponse(url=FRONTEND_URL, status_code=302)

    expected_state = request.cookies.get(INSTALL_STATE_COOKIE)
    if not expected_state or expected_state != state:
        logger.error(
            "[SLACK INSTALL] State mismatch | expected=%s | received=%s | IP=%s",
            expected_state,
            state,
            request.client.host if request and request.client else "unknown",
        )
        return RedirectResponse(
            url=f"{FRONTEND_URL}?slack_install_error=state_mismatch", status_code=302
        )

    logger.info(
        "[SLACK INSTALL] Calling oauth.v2.access | code=%s... | redirect_uri=%s",
        code[:10] if code else "None",
        SLACK_BOT_REDIRECT_URI,
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "client_id": SLACK_CLIENT_ID,
                "client_secret": SLACK_CLIENT_SECRET,
                "code": code,
                "redirect_uri": SLACK_BOT_REDIRECT_URI,
            },
            timeout=10.0,
        )
        result = resp.json()

    if not result.get("ok"):
        logger.error(
            "[SLACK INSTALL] oauth.v2.access failed | error=%s | response=%s",
            result.get("error", "unknown"),
            json.dumps(result)[:500],
        )
        response = RedirectResponse(
            url=f"{FRONTEND_URL}?slack_install_error={result.get('error', 'unknown')}",
            status_code=302,
        )
        response.delete_cookie(
            key=INSTALL_STATE_COOKIE, path="/api/slack/install/callback"
        )
        return response

    bot_token = result.get("access_token", "")
    team_id = result.get("team", {}).get("id", "")
    refresh_token = result.get("refresh_token", "")
    expires_in = result.get("expires_in", 0)
    logger.info(
        "[SLACK INSTALL] oauth.v2.access success | team_id=%s | access_token=%s... | has_refresh_token=%s | expires_in=%s",
        team_id,
        bot_token[:10] if bot_token else "None",
        bool(refresh_token),
        expires_in,
    )

    config = get_slack_config(db)
    encrypted_token = encrypt_token(bot_token)
    if config:
        logger.info(
            "[SLACK INSTALL] Updating existing Slack config | config_id=%s | team_id=%s",
            config.id,
            team_id,
        )
        config.bot_token = encrypted_token
        config.slack_team_id = team_id
        config.encrypted = True
        if refresh_token:
            config.refresh_token = encrypt_token(refresh_token)
            logger.info("[SLACK INSTALL] Stored refresh_token (token rotation enabled)")
        if expires_in:
            config.token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
            logger.info("[SLACK INSTALL] Token expires at: %s", config.token_expires_at)
        # Signing secret is app-level (from Basic Information), not returned by oauth.v2.access.
        # Only set it if it hasn't been configured yet and we have one from env.
        if not config.signing_secret and SLACK_SIGNING_SECRET:
            config.signing_secret = encrypt_token(SLACK_SIGNING_SECRET)
        db.commit()
        logger.info(
            "[SLACK INSTALL] Slack config updated successfully | config_id=%s",
            config.id,
        )
    else:
        logger.info("[SLACK INSTALL] Creating new Slack config | team_id=%s", team_id)
        signing_secret = (
            encrypt_token(SLACK_SIGNING_SECRET) if SLACK_SIGNING_SECRET else ""
        )
        config = SlackConfig(
            bot_token=encrypted_token,
            signing_secret=signing_secret,
            slack_team_id=team_id,
            encrypted=True,
        )
        if refresh_token:
            config.refresh_token = encrypt_token(refresh_token)
            logger.info("[SLACK INSTALL] Stored refresh_token (token rotation enabled)")
        if expires_in:
            config.token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
            logger.info("[SLACK INSTALL] Token expires at: %s", config.token_expires_at)
        db.add(config)
        db.commit()
        db.refresh(config)
        logger.info(
            "[SLACK INSTALL] Slack config created successfully | config_id=%s | team_id=%s",
            config.id,
            team_id,
        )

    response = RedirectResponse(
        url=f"{FRONTEND_URL}?slack_install=success", status_code=302
    )
    response.delete_cookie(key=INSTALL_STATE_COOKIE, path="/api/slack/install/callback")
    return response


@app.get("/api/slack/status", response_model=SlackStatusResponse)
def get_slack_connection_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns the overall Slack connection health status including token expiry info."""
    config = get_slack_config(db)
    if not config:
        return SlackStatusResponse(
            configured=False,
            channel_id="",
            channel_name="",
            bot_token_set=False,
            refresh_token_set=False,
            token_expires_at=None,
            token_expiring_soon=False,
            connection_health="not_configured",
        )

    bot_token_set = bool(config.bot_token)
    refresh_token_set = bool(config.refresh_token)
    token_expires_at = config.token_expires_at

    # Determine connection health
    if not bot_token_set:
        health = "no_token"
    elif refresh_token_set:
        if token_expires_at:
            if _is_token_expiring_soon(token_expires_at):
                health = "expiring_soon"
            else:
                health = "healthy"
        else:
            # Has refresh_token but no expiry — rotation may be enabled but we didn't capture expiry
            health = "healthy"
    else:
        # Has bot_token but no refresh_token — rotation likely not enabled, token shouldn't expire
        health = "healthy_no_rotation"

    return SlackStatusResponse(
        configured=True,
        channel_id="",
        channel_name="",
        bot_token_set=bot_token_set,
        refresh_token_set=refresh_token_set,
        token_expires_at=token_expires_at.strftime("%Y-%m-%d %H:%M:%S")
        if token_expires_at
        else None,
        token_expiring_soon=_is_token_expiring_soon(token_expires_at)
        if token_expires_at
        else False,
        connection_health=health,
    )


@app.post("/api/slack/status")
def get_slack_status(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    config = get_slack_config(db)
    return SlackStatusResponse(
        configured=bool(config),
        channel_id=project.slack_channel_id,
        channel_name=project.slack_channel_name,
    )


# ---------- Slack raw message logging ----------


@app.post("/api/slack/messages/log")
def log_slack_message(
    data: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    msg = SlackMessage(
        project_id=data.get("project_id"),
        slack_user_id=data.get("slack_user_id", ""),
        slack_user_name=data.get("slack_user_name", ""),
        channel_id=data.get("channel_id", ""),
        text=data.get("text", ""),
        ts=data.get("ts", ""),
        raw_json=data.get("raw", {}),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return SlackMessageResponse.model_validate(msg)


@app.get(
    "/api/projects/{project_id}/slack-messages",
    response_model=List[SlackMessageResponse],
)
def get_slack_messages(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access Slack messages")
    messages = (
        db.query(SlackMessage)
        .filter(SlackMessage.project_id == project_id)
        .order_by(SlackMessage.created_at.desc())
        .limit(100)
        .all()
    )
    return [SlackMessageResponse.model_validate(m) for m in messages]


@app.get(
    "/api/projects/{project_id}/slack-channel-history",
)
async def get_slack_channel_history(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access Slack messages")

    if not project.slack_channel_id:
        return {"messages": [], "channel_id": "", "has_channel": False}
    config = get_slack_config(db)
    if not config:
        return {
            "messages": [],
            "channel_id": project.slack_channel_id,
            "has_channel": True,
        }

    try:
        result = await slack_api_call(
            db, "conversations.history", {"channel": project.slack_channel_id, "limit": 100}
        )
    except RuntimeError as e:
        logger.warning("[SLACK HISTORY] Slack API error | error=%s", str(e))
        return {
            "messages": [],
            "channel_id": project.slack_channel_id,
            "has_channel": True,
            "error": str(e),
        }
    if result is None:
        return {
            "messages": [],
            "channel_id": project.slack_channel_id,
            "has_channel": True,
            "error": "Failed to fetch channel history",
        }
    if not result.get("ok"):
        logger.warning(
            "[SLACK HISTORY] Failed to fetch channel history | error=%s",
            result.get("error"),
        )
        return {
            "messages": [],
            "channel_id": project.slack_channel_id,
            "has_channel": True,
            "error": result.get("error"),
        }

    raw_messages = result.get("messages", [])
    formatted = []
    user_cache = {}
    for msg in raw_messages:
        user_name = ""
        if msg.get("user") and msg["user"] not in user_cache:
            try:
                user_result = await slack_api_call(db, "users.info", {"user": msg["user"]})
            except RuntimeError:
                user_cache[msg["user"]] = "Unknown"
                continue
            if user_result and user_result.get("ok"):
                user_cache[msg["user"]] = user_result["user"]["profile"].get(
                    "real_name", "Unknown"
                )
            else:
                user_cache[msg["user"]] = ""
        user_name = user_cache.get(msg.get("user", ""), "")
        ts_float = float(msg["ts"])
        ts_int = int(ts_float)
        dt = datetime.fromtimestamp(ts_int)
        time_str = dt.strftime("%Y-%m-%d %H:%M:%S")
        formatted.append(
            {
                "id": msg.get("ts", ""),
                "user_id": msg.get("user", ""),
                "user_name": user_name or "Slack Bot",
                "text": msg.get("text", ""),
                "ts": msg.get("ts", ""),
                "created_at": time_str,
                "is_bot": msg.get("bot_id") is not None,
            }
        )
    return {
        "messages": formatted,
        "channel_id": project.slack_channel_id,
        "has_channel": True,
    }


# ---------- Slack Webhook Endpoint ----------


@app.get("/api/slack/webhook")
@app.post("/api/slack/webhook")
async def slack_webhook(request: Request, db: Session = Depends(get_db)):
    if request.method == "GET":
        challenge = request.query_params.get("challenge", "")
        logger.info(
            "[SLACK WEBHOOK] URL verification GET received | challenge=%s", challenge
        )
        return {"challenge": challenge}

    raw_body = await request.body()
    content_type = request.headers.get("content-type", "")
    ip = request.client.host if request.client else "unknown"
    logger.info(
        "[SLACK WEBHOOK] Request received | IP=%s | content_type=%s | timestamp=%s",
        ip,
        content_type,
        request.headers.get("x-slack-request-timestamp", "0"),
    )

    timestamp = request.headers.get("x-slack-request-timestamp", "0")
    signature = request.headers.get("x-slack-signature", "")

    config = get_slack_config(db)
    if config:
        signing_secret = (
            decrypt_token(config.signing_secret)
            if config.encrypted
            else config.signing_secret
        )
        if not signing_secret:
            logger.warning(
                "[SLACK WEBHOOK] No signing_secret available for verification | config_id=%s",
                config.id,
            )
        if not verify_slack_signature(
            timestamp, signature, raw_body.decode(), signing_secret
        ):
            logger.warning(
                "[SLACK WEBHOOK] Signature verification failed | IP=%s | timestamp=%s | signature=%s...",
                ip,
                timestamp,
                signature[:20] if signature else "None",
            )
            return JSONResponse(
                status_code=403, content={"message": "Invalid signature"}
            )
    else:
        logger.debug(
            "[SLACK WEBHOOK] No Slack config found, skipping signature verification | IP=%s",
            ip,
        )

    payload = {}
    try:
        if "json" in content_type:
            payload = json.loads(raw_body.decode())
        else:
            form_data = await request.form()
            payload = json.loads(form_data.get("payload", "{}"))
        logger.debug(
            "[SLACK WEBHOOK] Payload parsed | type=%s", payload.get("type", "unknown")
        )
    except Exception as e:
        logger.error(
            "[SLACK WEBHOOK] Failed to parse payload | error=%s | content_type=%s",
            e,
            content_type,
        )
        payload = {}

    if payload.get("type") == "url_verification":
        challenge = payload.get("challenge", "")
        logger.info("[SLACK WEBHOOK] URL verification challenge: %s", challenge)
        return {"challenge": challenge}

    # Handle incoming text messages from designers (message.channels event)
    if payload.get("type") == "message" and payload.get("text"):
        text = payload.get("text", "")
        channel_id = payload.get("channel", "")
        user_id = payload.get("user", "")
        ts = payload.get("ts", "")
        logger.info(
            "[SLACK WEBHOOK] Incoming message | channel=%s | user=%s | ts=%s",
            channel_id, user_id, ts,
        )
        # Find project by channel
        project = db.query(Project).filter(
            Project.slack_channel_id == channel_id
        ).first()
        if project:
            # Parse structured info from message
            status_match = re.search(r'(?:^|\n)Status:\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
            blockers_match = re.search(r'(?:^|\n)Blockers:\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
            update_match = re.search(r'(?:^|\n)Update:\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
            progress_match = re.search(r'(?:^|\n)Progress:\s*(\d+)%?', text, re.IGNORECASE)
            
            status_text = status_match.group(1).strip() if status_match else None
            blockers_text = blockers_match.group(1).strip() if blockers_match else None
            update_text = update_match.group(1).strip() if update_match else None
            progress_val = int(progress_match.group(1)) if progress_match else None
            
            # Resolve user name
            user_name = ""
            try:
                user_result = await slack_api_call(db, "users.info", {"user": user_id})
                if user_result and user_result.get("ok"):
                    user_name = user_result["user"]["profile"].get("real_name", "")
            except Exception:
                pass
            
            # Log the parsed message
            parsed_msg = SlackMessage(
                project_id=project.id,
                slack_user_id=user_id,
                slack_user_name=user_name or "Unknown",
                channel_id=channel_id,
                text=text,
                ts=ts,
                raw_json={"status": status_text, "blockers": blockers_text, "update": update_text, "progress": progress_val, "raw": text},
            )
            db.add(parsed_msg)
            
            # Update phase if message is from assigned designer
            if project.assigned_designer_id:
                phases = (
                    db.query(Phase)
                    .filter(Phase.project_id == project.id)
                    .order_by(Phase.stage_index)
                    .all()
                )
                current_phase = (
                    phases[project.stage_index]
                    if project.stage_index < len(phases)
                    else None
                )
                if current_phase:
                    notes_parts = []
                    if status_text:
                        notes_parts.append(f"Status: {status_text}")
                    if update_text:
                        notes_parts.append(f"Update: {update_text}")
                    if blockers_text:
                        notes_parts.append(f"Blockers: {blockers_text}")
                    if notes_parts:
                        current_phase.designer_update = "\n".join(notes_parts)
                    if progress_val is not None:
                        project.progress = progress_val
                        if progress_val == 100:
                            project.status = "COMPLETED"
                        elif project.deadline < datetime.utcnow().strftime("%Y-%m-%d"):
                            project.status = "DELAYED"
                        else:
                            project.status = "ON_TRACK"
            
            db.commit()
            db.refresh(parsed_msg)
            return {"message": "OK"}

    if not config:
        logger.warning(
            "[SLACK WEBHOOK] Slack not configured, ignoring webhook | type=%s",
            payload.get("type"),
        )
        return {"message": "Slack not configured"}
    if "type" in payload:
        if payload["type"] == "block_actions":
            action = payload.get("actions", [{}])[0]
            action_id = action.get("action_id", "")
            value = action.get("value", "")
            user = payload.get("user", {})
            channel_id = payload.get("channel", {}).get("id", "")
            slack_user_id = user.get("id", "")
            slack_user_name = user.get("name", "")
            message_ts = payload.get("message_ts", "")
            project_id_val = int(value) if value.isdigit() else 0
            logger.info(
                "[SLACK WEBHOOK] block_actions received | action_id=%s | project_id=%s | slack_user=%s | channel=%s",
                action_id,
                project_id_val,
                slack_user_name,
                channel_id,
            )
            activity = SlackActivity(
                project_id=project_id_val,
                channel_id=channel_id,
                message_ts=message_ts,
                action_type=action_id,
                user_id=slack_user_id,
                user_name=slack_user_name,
                payload=payload,
            )
            db.add(activity)
            try:
                project_id = int(value)
                project = db.query(Project).filter(Project.id == project_id).first()
                if not project:
                    logger.warning(
                        "[SLACK WEBHOOK] Project not found for action | action_id=%s | value=%s",
                        action_id,
                        value,
                    )
                    return {
                        "response_action": "errors",
                        "errors": [{"field": "project", "text": "Project not found"}],
                    }
                designer = (
                    db.query(User)
                    .filter(User.id == project.assigned_designer_id)
                    .first()
                    if project.assigned_designer_id
                    else None
                )
                phases = (
                    db.query(Phase)
                    .filter(Phase.project_id == project_id)
                    .order_by(Phase.stage_index)
                    .all()
                )
                if action_id == "complete_stage":
                    stage_idx = int(value)
                    logger.info(
                        "[SLACK WEBHOOK] complete_stage action | project_id=%s | stage_idx=%s",
                        project_id,
                        stage_idx,
                    )
                    if stage_idx >= len(phases):
                        logger.warning(
                            "[SLACK WEBHOOK] Stage not found | stage_idx=%s | total_phases=%s",
                            stage_idx,
                            len(phases),
                        )
                        return {
                            "response_action": "errors",
                            "errors": [{"field": "stage", "text": "Stage not found"}],
                        }
                    if stage_idx > 0:
                        prev_phase = phases[stage_idx - 1]
                        if not prev_phase.completed_at:
                            prev_name = _get_current_stage_name(stage_idx - 1)
                            logger.info(
                                "[SLACK WEBHOOK] Previous stage not completed | prev_stage=%s",
                                prev_name,
                            )
                            return {
                                "response_action": "errors",
                                "errors": [
                                    {
                                        "field": "stage",
                                        "text": f"Complete {prev_name} first!",
                                    }
                                ],
                            }
                    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
                    phases[stage_idx].completed_at = now
                    total = len(phases)
                    completed = sum(1 for ph in phases if ph.completed_at)
                    project.progress = round((completed / total) * 100)
                    project.stage_index = min(stage_idx + 1, total - 1)
                    today_str = datetime.utcnow().strftime("%Y-%m-%d")
                    if project.progress == 100:
                        project.status = "COMPLETED"
                    elif project.deadline < today_str:
                        project.status = "DELAYED"
                    else:
                        project.status = "ON_TRACK"
                    db.commit()
                    logger.info(
                        "[SLACK WEBHOOK] Stage completed | project=%s | stage_idx=%s | progress=%s%% | status=%s",
                        project.name,
                        stage_idx,
                        project.progress,
                        project.status,
                    )
                    if project.progress == 100:
                        blocks = [
                            {
                                "type": "header",
                                "text": {
                                    "type": "plain_text",
                                    "text": "🎉 Project Completed!",
                                },
                            },
                            {
                                "type": "section",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": f"*{project.name}*\n\nAll {total} stages completed!\n👤 {designer.name if designer else 'Unassigned'}\n📊 100%\n\nGreat work! 🙌",
                                },
                            },
                        ]
                        if project.slack_channel_id:
                            await slack_api_call(
                                db,
                                "chat.update",
                                {
                                    "channel": project.slack_channel_id,
                                    "ts": message_ts,
                                    "blocks": blocks,
                                },
                            )
                    else:
                        next_stage = _get_current_stage_name(project.stage_index)
                        blocks = [
                            {
                                "type": "header",
                                "text": {
                                    "type": "plain_text",
                                    "text": f"✅ Stage Complete",
                                },
                            },
                            {
                                "type": "section",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": f"📦 {project.name}\n📊 Progress: {project.progress}%\n🔄 Next: {next_stage}",
                                },
                            },
                            {"type": "divider"},
                            {
                                "type": "actions",
                                "elements": [
                                    {
                                        "type": "button",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "📊 Progress",
                                        },
                                        "action_id": "view_progress",
                                        "value": str(project.id),
                                    },
                                    {
                                        "type": "button",
                                        "text": {
                                            "type": "plain_text",
                                            "text": "📦 Project Info",
                                        },
                                        "action_id": "view_project",
                                        "value": str(project.id),
                                    },
                                ],
                            },
                        ]
                        if project.slack_channel_id:
                            await slack_api_call(
                                db,
                                "chat.update",
                                {
                                    "channel": project.slack_channel_id,
                                    "ts": message_ts,
                                    "blocks": blocks,
                                },
                            )
                elif action_id == "submit_report":
                    current_stage = _get_current_stage_name(project.stage_index)
                    report_blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "📊 Stage Evaluation Report"},
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"📦 *{project.name}*\n🔄 Stage: {current_stage} (Stage {project.stage_index + 1}/9)",
                            },
                        },
                        {"type": "divider"},
                        {
                            "type": "input",
                            "block_id": "report_costing",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_costing",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "1️⃣ Costing of the product (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_willingness",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_willingness_to_buy",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "2️⃣ Willingness to buy (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_engagement",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_engagement_life",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "3️⃣ Engagement life (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_durability",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_durability",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "4️⃣ Durability (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_age",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_age_appropriateness",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "5️⃣ Age Appropriateness (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_ease",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_ease_of_use",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "6️⃣ Ease of use (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_aesthetics",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_aesthetics",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "7️⃣ Aesthetics of the Products (1-5)"},
                            "optional": True,
                        },
                        {
                            "type": "input",
                            "block_id": "report_store",
                            "element": {
                                "type": "number_input",
                                "action_id": "rating_easy_to_store",
                                "min_value": "1",
                                "max_value": "5",
                                "is_decimal_allowed": False,
                            },
                            "label": {"type": "plain_text", "text": "8️⃣ Easy to store / Travel Friendliness (1-5)"},
                            "optional": True,
                        },
                        {"type": "divider"},
                        {
                            "type": "input",
                            "block_id": "report_notes",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "report_notes",
                                "multi_line": True,
                            },
                            "label": {"type": "plain_text", "text": "💬 Additional notes / observations"},
                            "optional": True,
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "views.open",
                            {
                                "trigger_id": payload.get("trigger_id"),
                                "view": {
                                    "type": "modal",
                                    "callback_id": f"stage_report_form_{project_id}_{project.stage_index}",
                                    "title": {"type": "plain_text", "text": "📊 Stage Evaluation Report"},
                                    "submit": {"type": "plain_text", "text": "Submit Report"},
                                    "close": {"type": "plain_text", "text": "Cancel"},
                                    "blocks": report_blocks,
                                    "clear_on_close": True,
                                },
                            },
                        )
                elif action_id == "report_delay":
                    blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "⚠️ Report Delay"},
                        },
                        {
                            "type": "input",
                            "block_id": "delay_input",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "delay_reason",
                            },
                            "label": {"type": "plain_text", "text": "Reason for delay"},
                        },
                        {
                            "type": "input",
                            "block_id": "revised_input",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "revised_date",
                                "placeholder": {
                                    "type": "plain_text",
                                    "text": "YYYY-MM-DD",
                                },
                            },
                            "label": {"type": "plain_text", "text": "Revised deadline"},
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "views.open",
                            {
                                "trigger_id": payload.get("trigger_id"),
                                "view": {
                                    "type": "modal",
                                    "callback_id": f"delay_form_{project_id}",
                                    "title": {
                                        "type": "plain_text",
                                        "text": "⚠️ Report Delay",
                                    },
                                    "submit": {"type": "plain_text", "text": "Submit"},
                                    "close": {"type": "plain_text", "text": "Cancel"},
                                    "blocks": blocks,
                                },
                            },
                        )
                elif action_id == "update_notes":
                    blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "📝 Update Notes"},
                        },
                        {
                            "type": "input",
                            "block_id": "notes_input",
                            "element": {
                                "type": "multi_plain_text_input",
                                "action_id": "notes_text",
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "Your update/progress note",
                            },
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "views.open",
                            {
                                "trigger_id": payload.get("trigger_id"),
                                "view": {
                                    "type": "modal",
                                    "callback_id": f"notes_form_{project_id}",
                                    "title": {
                                        "type": "plain_text",
                                        "text": "📝 Update Notes",
                                    },
                                    "submit": {"type": "plain_text", "text": "Submit"},
                                    "close": {"type": "plain_text", "text": "Cancel"},
                                    "blocks": blocks,
                                },
                            },
                        )
                elif action_id == "view_project":
                    blocks = _build_project_card(project, designer, phases)
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.update",
                            {
                                "channel": project.slack_channel_id,
                                "ts": message_ts,
                                "blocks": blocks,
                            },
                        )
                elif action_id == "view_progress":
                    today_str = datetime.utcnow().strftime("%Y-%m-%d")
                    stages_completed = sum(1 for p in phases if p.completed_at)
                    total_stages = len(phases)
                    current_stage = _get_current_stage_name(project.stage_index)
                    reply_text = (
                        f"📊 *Progress Report*\n\n"
                        f"Project: {project.name}\n"
                        f"Total Progress: {project.progress}%\n"
                        f"Current Stage: {current_stage}\n\n"
                        f"Stage Breakdown:\n"
                    )
                    for i, phase in enumerate(phases):
                        check = "✅" if phase.completed_at else "⬜"
                        marker = " ➜" if i == project.stage_index else ""
                        reply_text += f"{check} {i + 1}. {phase.deadline}{marker}\n"
                    reply_text += f"\n📅 Deadline: {project.deadline}"
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.postMessage",
                            {"channel": project.slack_channel_id, "text": reply_text},
                        )
                elif action_id == "stage_update":
                    current_stage = _get_current_stage_name(project.stage_index)
                    current_phase = (
                        phases[project.stage_index]
                        if project.stage_index < len(phases)
                        else None
                    )
                    deadline = current_phase.deadline if current_phase else "N/A"
                    reply_text = (
                        f"🔄 *Current Stage: {current_stage}*\n\n"
                        f"📅 Deadline: {deadline}\n"
                        f"👤 Assigned: {designer.name if designer else 'Unassigned'}\n"
                        f"📊 Progress: {project.progress}%"
                    )
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.postMessage",
                            {"channel": project.slack_channel_id, "text": reply_text},
                        )
                elif action_id == "accept_project":
                    reply_text = (
                        f"✅ Project *{project.name}* accepted by {slack_user_name}!"
                    )
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.postMessage",
                            {"channel": project.slack_channel_id, "text": reply_text},
                        )
                elif action_id == "clarify_project":
                    blocks = [
                        {
                            "type": "header",
                            "text": {
                                "type": "plain_text",
                                "text": "❓ Project Clarification",
                            },
                        },
                        {
                            "type": "input",
                            "block_id": "clarify_input",
                            "element": {
                                "type": "plain_text_input",
                                "action_id": "clarify_text",
                                "multi_line": True,
                            },
                            "label": {
                                "type": "plain_text",
                                "text": "What would you like to clarify?",
                            },
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "views.open",
                            {
                                "trigger_id": payload.get("trigger_id"),
                                "view": {
                                    "type": "modal",
                                    "callback_id": f"clarify_form_{project_id}",
                                    "title": {
                                        "type": "plain_text",
                                        "text": "❓ Clarification",
                                    },
                                    "submit": {"type": "plain_text", "text": "Submit"},
                                    "close": {"type": "plain_text", "text": "Cancel"},
                                    "blocks": blocks,
                                },
                            },
                        )
            except Exception as e:
                logger.error(
                    "[SLACK WEBHOOK] Action processing failed | action_id=%s | project_id=%s | error=%s | traceback=%s",
                    action_id,
                    project_id,
                    e,
                    traceback.format_exc(),
                )
                db.rollback()
                return {
                    "response_action": "errors",
                    "errors": [{"field": "action", "text": "An error occurred. Please check the logs."}],
                }
            db.commit()
            return {"response_action": "updated"}
        elif payload["type"] == "view_submission":
            callback_id = payload.get("view", {}).get("callback_id", "")
            state = payload.get("view", {}).get("state", {}).get("values", {})
            logger.info(
                "[SLACK WEBHOOK] view_submission received | callback_id=%s", callback_id
            )
            if "delay_form_" in callback_id:
                project_id = int(callback_id.split("_")[-1])
                logger.info(
                    "[SLACK WEBHOOK] Delay form submitted | project_id=%s", project_id
                )
                project = db.query(Project).filter(Project.id == project_id).first()
                phases = (
                    db.query(Phase)
                    .filter(Phase.project_id == project_id)
                    .order_by(Phase.stage_index)
                    .all()
                )
                if project:
                    reason = (
                        state.get("delay_input", {})
                        .get("delay_reason", {})
                        .get("value", "N/A")
                    )
                    revised = (
                        state.get("revised_input", {})
                        .get("revised_date", {})
                        .get("value", "TBD")
                    )
                    logger.info(
                        "[SLACK WEBHOOK] Delay reported | project=%s | reason=%s | revised=%s",
                        project.name,
                        reason,
                        revised,
                    )
                    if phases[project.stage_index]:
                        phases[
                            project.stage_index
                        ].delay_reason = f"{reason} (Revised: {revised})"
                        db.commit()
                    blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "⚠️ Delay Reported"},
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"📋 Reason: {reason}\n📅 Revised: {revised}\n📦 Project: {project.name}",
                            },
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.update",
                            {
                                "channel": project.slack_channel_id,
                                "ts": payload.get("view", {})
                                .get("latest", {})
                                .get("ts"),
                                "blocks": blocks,
                            },
                        )
            elif "notes_form_" in callback_id:
                project_id = int(callback_id.split("_")[-1])
                logger.info(
                    "[SLACK WEBHOOK] Notes form submitted | project_id=%s", project_id
                )
                project = db.query(Project).filter(Project.id == project_id).first()
                phases = (
                    db.query(Phase)
                    .filter(Phase.project_id == project_id)
                    .order_by(Phase.stage_index)
                    .all()
                )
                if project:
                    notes = (
                        state.get("notes_input", {})
                        .get("notes_text", {})
                        .get("value", "")
                    )
                    logger.info(
                        "[SLACK WEBHOOK] Designer notes updated | project=%s | notes=%s",
                        project.name,
                        notes[:100],
                    )
                    if phases[project.stage_index]:
                        phases[project.stage_index].designer_update = notes
                        db.commit()
                    blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "✅ Notes Updated"},
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"📝 Your note has been logged.\n📦 Project: {project.name}\n🔄 Current Stage: {_get_current_stage_name(project.stage_index)}",
                            },
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.update",
                            {
                                "channel": project.slack_channel_id,
                                "ts": payload.get("view", {})
                                .get("latest", {})
                                .get("ts"),
                                "blocks": blocks,
                            },
                        )
            elif "clarify_form_" in callback_id:
                project_id = int(callback_id.split("_")[-1])
                logger.info(
                    "[SLACK WEBHOOK] Clarification form submitted | project_id=%s",
                    project_id,
                )
                project = db.query(Project).filter(Project.id == project_id).first()
                if project:
                    clarification = (
                        state.get("clarify_input", {})
                        .get("clarify_text", {})
                        .get("value", "")
                    )
                    logger.info(
                        "[SLACK WEBHOOK] Clarification received | project=%s | clarification=%s",
                        project.name,
                        clarification[:200],
                    )
                    slack_user_id = payload.get("user", {}).get("id", "")
                    slack_user_name = payload.get("user", {}).get("name", "")
                    channel_id = payload.get("channel", {}).get("id", "")
                    activity = SlackActivity(
                        project_id=project_id,
                        channel_id=channel_id,
                        message_ts="",
                        action_type="clarification",
                        user_id=slack_user_id,
                        user_name=slack_user_name,
                        payload={"clarification": clarification},
                    )
                    db.add(activity)
                    db.commit()
                    blocks = [
                        {
                            "type": "header",
                            "text": {
                                "type": "plain_text",
                                "text": "❓ Clarification Received",
                            },
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"📦 Project: {project.name}\n💬 {clarification}\n\nThe project manager will respond.",
                            },
                        },
                    ]
                    if project.slack_channel_id:
                        await slack_api_call(
                            db,
                            "chat.update",
                            {
                                "channel": project.slack_channel_id,
                                "ts": payload.get("view", {})
                                .get("latest", {})
                                .get("ts"),
                                "blocks": blocks,
                            },
                        )
            elif "stage_report_form_" in callback_id:
                parts = callback_id.split("_")
                project_id = int(parts[-2])
                stage_index = int(parts[-1])
                logger.info(
                    "[SLACK WEBHOOK] Stage report submitted | project_id=%s | stage_index=%s",
                    project_id,
                    stage_index,
                )
                project = db.query(Project).filter(Project.id == project_id).first()
                if not project:
                    logger.warning(
                        "[SLACK WEBHOOK] Project not found for report | project_id=%s",
                        project_id,
                    )
                    return {
                        "response_action": "errors",
                        "errors": [{"field": "project", "text": "Project not found"}],
                    }
                designer = (
                    db.query(User)
                    .filter(User.id == project.assigned_designer_id)
                    .first()
                    if project.assigned_designer_id
                    else None
                )
                phases = (
                    db.query(Phase)
                    .filter(Phase.project_id == project_id)
                    .order_by(Phase.stage_index)
                    .all()
                )
                state = payload.get("view", {}).get("state", {}).get("values", {})
                rating_map = [
                    ("report_costing", "rating_costing", "costing"),
                    ("report_willingness", "rating_willingness_to_buy", "willingness_to_buy"),
                    ("report_engagement", "rating_engagement_life", "engagement_life"),
                    ("report_durability", "rating_durability", "durability"),
                    ("report_age", "rating_age_appropriateness", "age_appropriateness"),
                    ("report_ease", "rating_ease_of_use", "ease_of_use"),
                    ("report_aesthetics", "rating_aesthetics", "aesthetics"),
                    ("report_store", "rating_easy_to_store", "easy_to_store"),
                ]
                ratings = {}
                for block_id, action_id, field_name in rating_map:
                    val = (
                        state.get(block_id, {})
                        .get(action_id, {})
                        .get("value")
                    )
                    ratings[field_name] = int(val) if val is not None else None
                notes_val = (
                    state.get("report_notes", {})
                    .get("report_notes", {})
                    .get("value", "")
                )
                slack_user_id = payload.get("user", {}).get("id", "")
                slack_user_name = payload.get("user", {}).get("name", "")
                channel_id = payload.get("channel", {}).get("id", "")
                stage_name = _get_current_stage_name(stage_index)
                
                # Calculate deadline and delay
                current_phase = phases[stage_index] if stage_index < len(phases) else None
                deadline = current_phase.deadline if current_phase else "N/A"
                today_str = datetime.utcnow().strftime("%Y-%m-%d")
                actual_completion = today_str
                delay_days = 0
                if deadline != "N/A":
                    try:
                        deadline_date = datetime.strptime(deadline, "%Y-%m-%d").date()
                        today_date = datetime.strptime(today_str, "%Y-%m-%d").date()
                        delta = (today_date - deadline_date).days
                        if delta > 0:
                            delay_days = delta
                    except (ValueError, TypeError):
                        pass
                
                # Save report
                report = StageReport(
                    project_id=project_id,
                    stage_index=stage_index,
                    stage_name=stage_name,
                    submitted_by_user_id=slack_user_id,
                    submitted_by_name=slack_user_name,
                    submitted_by_role="DESIGNER",
                    slack_user_id=slack_user_id,
                    costing=ratings.get("costing"),
                    willingness_to_buy=ratings.get("willingness_to_buy"),
                    engagement_life=ratings.get("engagement_life"),
                    durability=ratings.get("durability"),
                    age_appropriateness=ratings.get("age_appropriateness"),
                    ease_of_use=ratings.get("ease_of_use"),
                    aesthetics=ratings.get("aesthetics"),
                    easy_to_store=ratings.get("easy_to_store"),
                    notes=notes_val,
                    actual_completion_date=actual_completion,
                    delay_days=delay_days,
                    stage_completed=True,
                )
                db.add(report)
                
                # Auto-complete stage and advance project
                if current_phase:
                    current_phase.completed_at = actual_completion
                    current_phase.designer_update = notes_val or "Report submitted via Slack"
                    current_phase.delay_reason = f"{delay_days} day(s) delay" if delay_days > 0 else "On time"
                
                # Advance to next stage
                total_phases = len(phases)
                completed_stages = sum(1 for p in phases if p.completed_at)
                new_stage_index = min(stage_index + 1, total_phases - 1)
                project.stage_index = new_stage_index
                project.progress = round(((completed_stages + 1) / total_phases) * 100)
                project.updated_at = datetime.utcnow()
                
                if project.progress == 100:
                    project.status = "COMPLETED"
                elif today_str > project.deadline:
                    project.status = "DELAYED"
                else:
                    project.status = "ON_TRACK"
                
                db.commit()
                logger.info(
                    "[SLACK WEBHOOK] Report saved & stage advanced | report_id=%s | project=%s | stage=%s → %s | delay=%d days",
                    report.id,
                    project.name,
                    stage_index,
                    new_stage_index,
                    delay_days,
                )
                
                # Build timeline of completed stages
                timeline_lines = []
                for i, phase in enumerate(phases):
                    check = "✅" if phase.completed_at else "⬜"
                    marker = " ➜" if i == new_stage_index else ""
                    phase_name = _get_current_stage_name(i)
                    timeline_lines.append(f"{check} {i + 1}. {phase_name}{marker}")
                timeline_text = "\n".join(timeline_lines)
                
                rating_lines = []
                for block_id, action_id, field_name in rating_map:
                    val = ratings.get(field_name)
                    if val is not None:
                        emoji = "⭐" if val >= 4 else "🔸" if val >= 3 else "⚠️"
                        rating_lines.append(f"{emoji} {field_name.replace('_', ' ').title()}: {val}/5")
                rating_text = "\n".join(rating_lines) if rating_lines else "*No ratings submitted*"
                
                delay_text = ""
                if delay_days > 0:
                    delay_text = f"\n⚠️ *Delay:* {delay_days} day(s) past deadline ({deadline})"
                else:
                    delay_text = f"\n✅ *On Time:* Completed before deadline ({deadline})"
                
                next_stage_text = ""
                if new_stage_index < total_phases:
                    next_stage = _get_current_stage_name(new_stage_index)
                    next_phase = phases[new_stage_index] if new_stage_index < len(phases) else None
                    next_deadline = next_phase.deadline if next_phase else "TBD"
                    next_stage_text = f"\n🔄 *Next Stage:* {next_stage}\n📅 *New Deadline:* {next_deadline}"
                else:
                    next_stage_text = f"\n🎉 *All stages completed!*"
                
                confirmation_blocks = [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "✅ Stage Complete — Report Submitted"},
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"📦 *{project.name}*\n📊 Progress: {project.progress}%\n👤 {designer.name if designer else 'Unassigned'}{delay_text}{next_stage_text}",
                        },
                    },
                    {"type": "divider"},
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"*Evaluations:*\n{rating_text}"},
                    },
                    {"type": "divider"},
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Stage Progression:*\n<pre>{timeline_text}</pre>",
                        },
                    },
                ]
                if notes_val:
                    confirmation_blocks.append(
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"*Notes:*\n{notes_val}",
                            },
                        }
                    )
                confirmation_blocks.append(
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "📊 View Project"},
                                "action_id": "view_project",
                                "value": str(project_id),
                            },
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "📈 Progress"},
                                "action_id": "view_progress",
                                "value": str(project_id),
                            },
                        ],
                    }
                )
                if project.slack_channel_id:
                    await slack_api_call(
                        db,
                        "chat.postMessage",
                        {
                            "channel": project.slack_channel_id,
                            "blocks": confirmation_blocks,
                        },
                    )
                view_ts = payload.get("view", {}).get("latest", {}).get("ts")
                if view_ts:
                    updated_blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "✅ Report Submitted"},
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": f"📦 *{project.name}*\n🔄 Stage: {stage_name} → {new_stage_index + 1}/9\n✅ Report logged, stage advanced",
                            },
                        },
                    ]
                    await slack_api_call(
                        db,
                        "chat.update",
                        {
                            "channel": project.slack_channel_id,
                            "ts": view_ts,
                            "blocks": updated_blocks,
                        },
                    )
                return {}
            return {}
    return {"message": "OK"}


# ---------- Slack Channel Creation ----------


@app.post(
    "/api/projects/{project_id}/slack-channel",
    response_model=SlackChannelCreateResponse,
)
async def create_slack_channel(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logger.info(
        "[SLACK CHANNEL] Channel creation requested | project_id=%s | user_id=%s",
        project_id,
        user.id,
    )
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        logger.warning("[SLACK CHANNEL] Project not found | project_id=%s", project_id)
        return SlackChannelCreateResponse(
            channel_id="", channel_name="", success=False, message="Project not found"
        )
    if user.role.upper() == "MANAGER" and project.created_by_user_id != user.id:
        return SlackChannelCreateResponse(
            channel_id="",
            channel_name="",
            success=False,
            message="You can only manage Slack channels for your own projects",
        )
    if user.role.upper() == "DESIGNER":
        return SlackChannelCreateResponse(
            channel_id="",
            channel_name="",
            success=False,
            message="Designers cannot manage Slack channels",
        )
    config = get_slack_config(db)
    if not config:
        logger.warning(
            "[SLACK CHANNEL] Slack not configured | project_id=%s", project_id
        )
        return SlackChannelCreateResponse(
            channel_id="",
            channel_name="",
            success=False,
            message="Slack not configured",
        )
    base_channel_name = f"project-{project.name.lower().replace(' ', '-')}"
    channel_name = base_channel_name
    result = None
    max_attempts = 5
    for attempt in range(max_attempts):
        if attempt > 0:
            channel_name = f"{base_channel_name}-{attempt}"
        logger.info(
            "[SLACK CHANNEL] Creating Slack channel | project=%s | channel_name=%s",
            project.name,
            channel_name,
        )
        result = await slack_api_call(
            db, "conversations.create", {"name": channel_name, "is_private": False}
        )
        if result and result.get("ok"):
            break
        error_code = result.get("error", "") if result else ""
        if error_code != "name_taken":
            break
        logger.info(
            "[SLACK CHANNEL] Channel name taken, trying next | project=%s | attempt=%s",
            project.name,
            attempt,
        )
    if result and result.get("ok"):
        channel_id = result["channel"]["id"]
        project.slack_channel_id = channel_id
        project.slack_channel_name = channel_name
        db.commit()
        designer = (
            db.query(User).filter(User.id == project.assigned_designer_id).first()
        )
        designer_slack_id = designer.slack_user_id if designer else ""
        if not designer_slack_id and designer:
            designer_slack_id = await resolve_slack_user_id_by_email(db, designer.email)
        if user.role.upper() == "ADMIN":
            await invite_users_to_channel(db, channel_id, [user.slack_user_id])
        else:
            await invite_users_to_channel(
                db, channel_id, [user.slack_user_id, designer_slack_id]
            )
        logger.info(
            "[SLACK CHANNEL] Channel created successfully | project=%s | channel_id=%s | channel_name=%s",
            project.name,
            channel_id,
            channel_name,
        )
        return SlackChannelCreateResponse(
            channel_id=channel_id, channel_name=channel_name, success=True
        )
    else:
        error_msg = (
            result.get("error", "Unknown error") if result else "Slack API error"
        )
        logger.error(
            "[SLACK CHANNEL] Failed to create channel | project=%s | error=%s | response=%s",
            project.name,
            error_msg,
            json.dumps(result)[:500] if result else "None",
        )
        return SlackChannelCreateResponse(
            channel_id="", channel_name="", success=False, message=error_msg
        )


# ---------- Slack Activity Feed ----------


@app.get(
    "/api/projects/{project_id}/slack-activity",
    response_model=List[SlackActivityResponse],
)
def get_slack_activity(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "MANAGER" and project.created_by_user_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="You can only view Slack activity for your own projects",
        )
    if user.role.upper() == "DESIGNER":
        raise HTTPException(
            status_code=403, detail="Designers cannot view Slack activity via dashboard"
        )
    activities = (
        db.query(SlackActivity)
        .filter(SlackActivity.project_id == project_id)
        .order_by(SlackActivity.created_at.desc())
        .limit(50)
        .all()
    )
    return [SlackActivityResponse.model_validate(a) for a in activities]


# ---------- Slack Channel Status ----------


class ProjectSlackStatus(BaseModel):
    project_id: int
    project_name: str
    slack_channel_id: str
    slack_channel_name: str
    status: str  # 'connected' | 'archived' | 'not_found' | 'unknown'
    error: str = ""


class SlackChannelStatusBatchResponse(BaseModel):
    statuses: List[ProjectSlackStatus]
    corrected: List[ProjectSlackStatus] = []


@app.get(
    "/api/projects/slack-channel-status",
    response_model=SlackChannelStatusBatchResponse,
)
async def get_slack_channel_status(
    auto_correct: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch endpoint to check real Slack channel status for all projects.

    If auto_correct=True, clears slack_channel_id/name for projects where
    Slack reports the channel is missing or archived.
    """
    config = get_slack_config(db)
    projects = db.query(Project).filter(Project.slack_channel_id != "").all()

    statuses = []
    corrected = []

    for project in projects:
        result = await verify_channel(db, project.slack_channel_id)
        status = ProjectSlackStatus(
            project_id=project.id,
            project_name=project.name,
            slack_channel_id=project.slack_channel_id,
            slack_channel_name=project.slack_channel_name,
            status=result["status"],
            error=result["error"] or "",
        )
        statuses.append(status)

        if auto_correct and result["status"] in ("not_found", "archived"):
            project.slack_channel_id = ""
            project.slack_channel_name = ""
            corrected.append(status)

    if corrected:
        db.commit()

    return SlackChannelStatusBatchResponse(statuses=statuses, corrected=corrected)


# ---------- Add Bot to Channel ----------


class BotChannelActionResponse(BaseModel):
    success: bool
    message: str = ""


@app.post(
    "/api/projects/{project_id}/bot/add-to-channel",
    response_model=BotChannelActionResponse,
)
async def add_bot_to_channel(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invite the Slack bot to the project's Slack channel."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return BotChannelActionResponse(success=False, message="Project not found")
    if user.role.upper() == "MANAGER" and project.created_by_user_id != user.id:
        return BotChannelActionResponse(
            success=False, message="You can only manage the bot for your own projects"
        )
    if user.role.upper() == "DESIGNER":
        return BotChannelActionResponse(
            success=False, message="Designers cannot manage bot access"
        )
    config = get_slack_config(db)
    if not config:
        return BotChannelActionResponse(success=False, message="Slack not configured")
    if not project.slack_channel_id:
        return BotChannelActionResponse(
            success=False, message="No Slack channel connected to this project"
        )
    result = await slack_api_call(
        db,
        "conversations.join",
        {"channel": project.slack_channel_id},
    )
    if result is None:
        return BotChannelActionResponse(
            success=False, message="Slack API unreachable"
        )
    if not result.get("ok"):
        error_code = result.get("error", "")
        if error_code == "already_in_channel":
            return BotChannelActionResponse(
                success=True, message="Bot is already in this channel"
            )
        logger.error(
            "[BOT JOIN] Failed to add bot to channel | project=%s | channel=%s | error=%s",
            project.name,
            project.slack_channel_id,
            error_code,
        )
        return BotChannelActionResponse(
            success=False, message=f"Failed to add bot: {error_code}"
        )
    logger.info(
        "[BOT JOIN] Bot added to channel successfully | project=%s | channel=%s",
        project.name,
        project.slack_channel_id,
    )
    return BotChannelActionResponse(
        success=True, message="Bot added to channel successfully"
    )


# ---------- Reminder Scheduler ----------


async def run_reminder_tick(db):
    """Core reminder logic, called by both the external cron endpoint and the
    in-process scheduler. Idempotent within a day, so it's safe to call this
    as often as you like (e.g. every few minutes) without spamming Slack."""
    now = datetime.now(REMINDER_TIMEZONE)
    today_str = now.strftime("%Y-%m-%d")
    sent_daily = 0
    sent_deadline = 0

    # 1) Daily ~10AM check-in for every active project, once per calendar day.
    if now.hour >= DAILY_REMINDER_HOUR:
        active_projects = (
            db.query(Project).filter(Project.status != "COMPLETED").all()
        )
        for project in active_projects:
            if not project.slack_channel_id:
                continue
            if (project.last_daily_reminder_date or "") == today_str:
                continue
            ok = await send_stage_update_reminder(db, project.id, kind="daily")
            if ok:
                project.last_daily_reminder_date = today_str
                project.last_reminder_sent_at = datetime.utcnow()
                db.commit()
                sent_daily += 1

    # 2) Deadline-day reminder — fires once per phase, on the exact date of
    # that phase's deadline, regardless of the current stage.
    due_phases = (
        db.query(Phase)
        .filter(
            Phase.deadline == today_str,
            Phase.completed_at.is_(None),
            Phase.deadline_reminder_sent.is_(False),
        )
        .all()
    )
    for phase in due_phases:
        ok = await send_stage_update_reminder(
            db, phase.project_id, kind="deadline", phase=phase
        )
        if ok:
            phase.deadline_reminder_sent = True
            db.commit()
            sent_deadline += 1

    logger.info(
        "[REMINDER TICK] now=%s | daily_sent=%s | deadline_sent=%s",
        now.isoformat(),
        sent_daily,
        sent_deadline,
    )
    return {"daily_sent": sent_daily, "deadline_sent": sent_deadline, "checked_at": now.isoformat()}


@app.post("/api/cron/tick")
async def cron_tick(request: Request, db: Session = Depends(get_db)):
    """Trigger a reminder check. Call this from an external cron service
    (e.g. cron-job.org, GitHub Actions, UptimeRobot) every 5-15 minutes.
    This also doubles as a wake-up ping for a sleeping free-tier Render
    service — the tick logic itself only sends messages once per day/phase
    no matter how often it's called."""
    if not CRON_SECRET:
        raise HTTPException(
            status_code=503,
            detail="CRON_SECRET is not configured on the server.",
        )
    provided = request.headers.get("x-cron-secret") or request.query_params.get(
        "secret", ""
    )
    if not hmac.compare_digest(provided, CRON_SECRET):
        raise HTTPException(status_code=403, detail="Invalid cron secret")
    result = await run_reminder_tick(db)
    return result


def _scheduler_loop():
    """Background thread that periodically runs the reminder tick while the
    process is alive. On a paid/always-on Render plan this is enough by
    itself. On the free tier the process sleeps when idle, so this thread
    sleeps too — that's why /api/cron/tick also exists for an external
    cron to hit."""
    import asyncio

    logger.info(
        "[SCHEDULER] In-process reminder scheduler started | interval=%ss",
        SCHEDULER_INTERVAL_SECONDS,
    )
    while True:
        time_module.sleep(SCHEDULER_INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            asyncio.run(run_reminder_tick(db))
        except Exception as e:
            logger.error("[SCHEDULER] Reminder tick failed: %s", e)
        finally:
            db.close()


@app.post("/api/projects/{project_id}/remind")
async def send_manual_reminder(
    project_id: int,
    user: User = Depends(require_role(["ADMIN", "MANAGER"])),
    db: Session = Depends(get_db),
):
    """Manager/admin-triggered 'Send Reminder' button — always asks about
    whatever the project's *current* stage is in the database right now."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "MANAGER" and project.created_by_user_id != user.id:
        raise HTTPException(
            status_code=403, detail="You can only remind on your own projects"
        )
    if not project.slack_channel_id:
        raise HTTPException(
            status_code=400,
            detail="This project has no Slack channel yet.",
        )
    ok = await send_stage_update_reminder(db, project_id, kind="manual")
    if not ok:
        raise HTTPException(
            status_code=400, detail="Slack is not configured or not reachable."
        )
    return {"message": "Reminder sent", "stage": _get_current_stage_name(project.stage_index)}


# ---------- Admin Data Export ----------


def _parse_export_range(from_param, to_param):
    """Parse optional from/to query params (date or datetime strings) into
    datetimes. Returns (None, None) when both are absent, meaning 'whole
    data, no filter'."""
    def _parse(value, end_of_day=False):
        if not value:
            return None
        try:
            if "T" in value or " " in value:
                return datetime.fromisoformat(value.replace("Z", ""))
            dt = datetime.strptime(value, "%Y-%m-%d")
            if end_of_day:
                dt = dt.replace(hour=23, minute=59, second=59)
            return dt
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date/time value: {value}. Use YYYY-MM-DD or ISO 8601.",
            )

    return _parse(from_param), _parse(to_param, end_of_day=True)


def _rows_to_csv_bytes(fieldnames, rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _sheets_to_xlsx_bytes(sheets):
    """sheets: dict of {sheet_name: (fieldnames, rows)}"""
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    for sheet_name, (fieldnames, rows) in sheets.items():
        ws = wb.create_sheet(title=sheet_name[:31])
        ws.append(fieldnames)
        for row in rows:
            ws.append([row.get(f, "") for f in fieldnames])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _users_rows(db, roles, dt_from, dt_to):
    q = db.query(User)
    if roles:
        q = q.filter(User.role.in_(roles))
    if dt_from:
        q = q.filter(User.created_at >= dt_from)
    if dt_to:
        q = q.filter(User.created_at <= dt_to)
    fieldnames = [
        "id", "name", "email", "role", "specialty", "slack_user_id",
        "created_at", "updated_at",
    ]
    rows = [
        {
            "id": u.id, "name": u.name, "email": u.email, "role": u.role,
            "specialty": u.specialty, "slack_user_id": u.slack_user_id or "",
            "created_at": u.created_at.isoformat() if u.created_at else "",
            "updated_at": u.updated_at.isoformat() if u.updated_at else "",
        }
        for u in q.all()
    ]
    return fieldnames, rows


def _projects_rows(db, dt_from, dt_to):
    q = db.query(Project)
    if dt_from:
        q = q.filter(Project.created_at >= dt_from)
    if dt_to:
        q = q.filter(Project.created_at <= dt_to)
    projects = q.all()
    fieldnames = [
        "id", "name", "description", "assigned_designer", "created_by",
        "stage_index", "current_stage", "progress", "status",
        "start_date", "deadline", "slack_channel_name", "created_at", "updated_at",
    ]
    rows = []
    for p in projects:
        designer = db.query(User).filter(User.id == p.assigned_designer_id).first()
        creator = db.query(User).filter(User.id == p.created_by_user_id).first()
        rows.append({
            "id": p.id, "name": p.name, "description": p.description,
            "assigned_designer": designer.name if designer else "",
            "created_by": creator.name if creator else "",
            "stage_index": p.stage_index,
            "current_stage": _get_current_stage_name(p.stage_index),
            "progress": p.progress, "status": p.status,
            "start_date": p.start_date, "deadline": p.deadline,
            "slack_channel_name": p.slack_channel_name,
            "created_at": p.created_at.isoformat() if p.created_at else "",
            "updated_at": p.updated_at.isoformat() if p.updated_at else "",
        })
    fieldnames_phase = [
        "project_id", "project_name", "stage_index", "stage_name", "deadline",
        "designer_update", "delay_reason", "completed_at",
    ]
    rows_phase = []
    for p in projects:
        for ph in sorted(p.phases, key=lambda x: x.stage_index):
            rows_phase.append({
                "project_id": p.id, "project_name": p.name,
                "stage_index": ph.stage_index,
                "stage_name": _get_current_stage_name(ph.stage_index),
                "deadline": ph.deadline, "designer_update": ph.designer_update,
                "delay_reason": ph.delay_reason,
                "completed_at": ph.completed_at or "",
            })
    return (fieldnames, rows), (fieldnames_phase, rows_phase)


@app.get("/api/admin/export/{entity}")
def export_data(
    entity: str,
    format: str = "csv",
    from_: Optional[str] = Query(default=None, alias="from"),
    to: Optional[str] = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only data export. entity: designers | managers | projects | all.
    format: csv | xlsx. If from/to are omitted, exports the whole dataset."""
    if format not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="format must be csv or xlsx")
    dt_from, dt_to = _parse_export_range(from_, to)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    if entity == "designers":
        fieldnames, rows = _users_rows(db, ["DESIGNER"], dt_from, dt_to)
        sheets = {"Designers": (fieldnames, rows)}
        filename = f"designers-{stamp}"
    elif entity == "managers":
        fieldnames, rows = _users_rows(db, ["ADMIN", "MANAGER"], dt_from, dt_to)
        sheets = {"Managers": (fieldnames, rows)}
        filename = f"managers-{stamp}"
    elif entity == "projects":
        (pf, pr), (phf, phr) = _projects_rows(db, dt_from, dt_to)
        sheets = {"Projects": (pf, pr), "Phases": (phf, phr)}
        filename = f"projects-{stamp}"
    elif entity == "all":
        df, dr = _users_rows(db, ["DESIGNER"], dt_from, dt_to)
        mf, mr = _users_rows(db, ["ADMIN", "MANAGER"], dt_from, dt_to)
        (pf, pr), (phf, phr) = _projects_rows(db, dt_from, dt_to)
        sheets = {
            "Designers": (df, dr), "Managers": (mf, mr),
            "Projects": (pf, pr), "Phases": (phf, phr),
        }
        filename = f"smartivity-all-data-{stamp}"
    else:
        raise HTTPException(
            status_code=404,
            detail="Unknown entity. Use designers, managers, projects, or all.",
        )

    if format == "xlsx":
        content = _sheets_to_xlsx_bytes(sheets)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename += ".xlsx"
    else:
        if len(sheets) == 1:
            fieldnames, rows = next(iter(sheets.values()))
            content = _rows_to_csv_bytes(fieldnames, rows)
        else:
            # Multiple tables requested as CSV: zip them together.
            import zipfile

            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
                for sheet_name, (fieldnames, rows) in sheets.items():
                    zf.writestr(f"{sheet_name}.csv", _rows_to_csv_bytes(fieldnames, rows))
            content = zbuf.getvalue()
            media_type = "application/zip"
            filename += ".zip"
            return StreamingResponse(
                io.BytesIO(content),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        media_type = "text/csv"
        filename += ".csv"

    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Stage Reports ----------


@app.post("/api/reports", response_model=StageReportResponse)
async def create_stage_report(
    report: StageReportCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logger.info(
        "[REPORTS] Report submission requested | project_id=%s | stage=%s | user=%s",
        report.project_id,
        report.stage_index,
        user.name,
    )
    project = db.query(Project).filter(Project.id == report.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() not in ("ADMIN", "MANAGER"):
        if str(user.id) != report.submitted_by_user_id:
            raise HTTPException(status_code=403, detail="Not authorized to submit this report")
    designer = (
        db.query(User)
        .filter(User.id == project.assigned_designer_id)
        .first()
        if project.assigned_designer_id
        else None
    )
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == report.project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    existing = (
        db.query(StageReport)
        .filter(
            StageReport.project_id == report.project_id,
            StageReport.stage_index == report.stage_index,
        )
        .first()
    )
    now_str = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Calculate deadline and delay
    current_phase = phases[report.stage_index] if report.stage_index < len(phases) else None
    deadline = current_phase.deadline if current_phase else "N/A"
    delay_days = 0
    if deadline != "N/A":
        try:
            deadline_date = datetime.strptime(deadline, "%Y-%m-%d").date()
            today_date = datetime.strptime(now_str, "%Y-%m-%d").date()
            delta = (today_date - deadline_date).days
            if delta > 0:
                delay_days = delta
        except (ValueError, TypeError):
            pass
    
    if existing:
        existing.costing = report.costing
        existing.willingness_to_buy = report.willingness_to_buy
        existing.engagement_life = report.engagement_life
        existing.durability = report.durability
        existing.age_appropriateness = report.age_appropriateness
        existing.ease_of_use = report.ease_of_use
        existing.aesthetics = report.aesthetics
        existing.easy_to_store = report.easy_to_store
        existing.notes = report.notes or ""
        existing.submitted_by_name = report.submitted_by_name
        existing.submitted_at = datetime.utcnow()
        existing.actual_completion_date = report.actual_completion_date or now_str
        existing.delay_days = delay_days
        existing.stage_completed = True
        # Update phase
        if current_phase:
            current_phase.completed_at = report.actual_completion_date or now_str
            current_phase.designer_update = report.notes or "Report submitted via web"
            current_phase.delay_reason = f"{delay_days} day(s) delay" if delay_days > 0 else "On time"
        # Advance project
        total_phases = len(phases)
        completed_stages = sum(1 for p in phases if p.completed_at)
        new_stage_index = min(report.stage_index + 1, total_phases - 1)
        project.stage_index = new_stage_index
        project.progress = round(((completed_stages + 1) / total_phases) * 100)
        project.updated_at = datetime.utcnow()
        if project.progress == 100:
            project.status = "COMPLETED"
        elif now_str > project.deadline:
            project.status = "DELAYED"
        else:
            project.status = "ON_TRACK"
        db.commit()
        db.refresh(existing)
        logger.info(
            "[REPORTS] Report updated & stage advanced | report_id=%s | project=%s | stage=%s → %s | delay=%d days",
            existing.id,
            project.name,
            report.stage_index,
            new_stage_index,
            delay_days,
        )
        return existing
    new_report = StageReport(
        project_id=report.project_id,
        stage_index=report.stage_index,
        stage_name=report.stage_name,
        submitted_by_user_id=report.submitted_by_user_id,
        submitted_by_name=report.submitted_by_name,
        submitted_by_role=report.submitted_by_role,
        slack_user_id=report.slack_user_id,
        costing=report.costing,
        willingness_to_buy=report.willingness_to_buy,
        engagement_life=report.engagement_life,
        durability=report.durability,
        age_appropriateness=report.age_appropriateness,
        ease_of_use=report.ease_of_use,
        aesthetics=report.aesthetics,
        easy_to_store=report.easy_to_store,
        notes=report.notes or "",
        actual_completion_date=report.actual_completion_date or now_str,
        delay_days=delay_days,
        stage_completed=True,
    )
    db.add(new_report)
    # Complete phase and advance project
    if current_phase:
        current_phase.completed_at = report.actual_completion_date or now_str
        current_phase.designer_update = report.notes or "Report submitted via web"
        current_phase.delay_reason = f"{delay_days} day(s) delay" if delay_days > 0 else "On time"
    total_phases = len(phases)
    completed_stages = sum(1 for p in phases if p.completed_at)
    new_stage_index = min(report.stage_index + 1, total_phases - 1)
    project.stage_index = new_stage_index
    project.progress = round(((completed_stages + 1) / total_phases) * 100)
    project.updated_at = datetime.utcnow()
    if project.progress == 100:
        project.status = "COMPLETED"
    elif now_str > project.deadline:
        project.status = "DELAYED"
    else:
        project.status = "ON_TRACK"
    db.commit()
    db.refresh(new_report)
    logger.info(
        "[REPORTS] Report created & stage advanced | report_id=%s | project=%s | stage=%s → %s | delay=%d days",
        new_report.id,
        project.name,
        report.stage_index,
        new_stage_index,
        delay_days,
    )
    return new_report


@app.get("/api/projects/{project_id}/reports", response_model=List[StageReportResponse])
async def get_project_reports(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    reports = (
        db.query(StageReport)
        .filter(StageReport.project_id == project_id)
        .order_by(StageReport.submitted_at.desc())
        .all()
    )
    logger.info("[REPORTS] Project reports fetched | project_id=%s | count=%s", project_id, len(reports))
    return reports


@app.get("/api/designers/{designer_id}/reports", response_model=List[StageReportResponse])
async def get_designer_reports(
    designer_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    designer = db.query(User).filter(User.id == designer_id).first()
    if not designer:
        raise HTTPException(status_code=404, detail="Designer not found")
    reports = (
        db.query(StageReport)
        .filter(StageReport.submitted_by_user_id == str(designer_id))
        .order_by(StageReport.submitted_at.desc())
        .all()
    )
    logger.info("[REPORTS] Designer reports fetched | designer_id=%s | count=%s", designer_id, len(reports))
    return reports


@app.get("/api/reports/summary", response_model=List[StageReportSummary])
async def get_report_summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    projects = db.query(Project).all()
    summaries = []
    for project in projects:
        phases = (
            db.query(Phase)
            .filter(Phase.project_id == project.id)
            .order_by(Phase.stage_index)
            .all()
        )
        for phase in phases:
            reports = (
                db.query(StageReport)
                .filter(
                    StageReport.project_id == project.id,
                    StageReport.stage_index == phase.stage_index,
                )
                .all()
            )
            if not reports:
                continue
            total = len(reports)
            valid_fields = [
                ("costing", "avg_costing"),
                ("willingness_to_buy", "avg_willingness_to_buy"),
                ("engagement_life", "avg_engagement_life"),
                ("durability", "avg_durability"),
                ("age_appropriateness", "avg_age_appropriateness"),
                ("ease_of_use", "avg_ease_of_use"),
                ("aesthetics", "avg_aesthetics"),
                ("easy_to_store", "avg_easy_to_store"),
            ]
            summary_dict = {
                "project_id": project.id,
                "project_name": project.name,
                "assigned_designer": designer.name if (designer := db.query(User).filter(User.id == project.assigned_designer_id).first()) else "Unassigned",
                "stage_index": phase.stage_index,
                "stage_name": _get_current_stage_name(phase.stage_index),
                "total_reports": total,
            }
            for field, avg_key in valid_fields:
                vals = [getattr(r, field) for r in reports if getattr(r, field) is not None]
                summary_dict[avg_key] = round(sum(vals) / len(vals), 1) if vals else None
            latest = max(reports, key=lambda r: r.submitted_at)
            summary_dict["latest_report_id"] = latest.id
            summary_dict["latest_submitted_at"] = latest.submitted_at
            summaries.append(StageReportSummary(**summary_dict))
    summaries.sort(key=lambda s: (s.project_id, s.stage_index))
    logger.info("[REPORTS] Summary fetched | total summaries=%s", len(summaries))
    return summaries


@app.get("/api/reports/project/{project_id}/designer/{designer_id}", response_model=List[StageReportResponse])
async def get_project_designer_reports(
    project_id: int,
    designer_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    reports = (
        db.query(StageReport)
        .filter(
            StageReport.project_id == project_id,
            StageReport.submitted_by_user_id == str(designer_id),
        )
        .order_by(StageReport.stage_index, StageReport.submitted_at.desc())
        .all()
    )
    return reports


# ---------- Project Reports (phasewise, weekly, monthly) ----------


@app.get("/api/projects/{project_id}/report", response_model=ProjectReportResponse)
async def get_project_report(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access project reports")
    if user.role.upper() == "MANAGER":
        is_creator = project.created_by_user_id == user.id
        is_assigned = bool(
            db.query(ProjectManager).filter(
                ProjectManager.project_id == project_id,
                ProjectManager.manager_id == user.id,
            ).first()
        )
        if not is_creator and not is_assigned:
            raise HTTPException(status_code=403, detail="You can only access your own projects")
    
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    stage_reports = (
        db.query(StageReport)
        .filter(StageReport.project_id == project_id)
        .order_by(StageReport.submitted_at.desc())
        .all()
    )
    designer = (
        db.query(User).filter(User.id == project.assigned_designer_id).first()
        if project.assigned_designer_id else None
    )
    
    phase_items = []
    for ph in phases:
        delay_days = 0
        if ph.completed_at:
            completed_dt = None
            for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]:
                try:
                    completed_dt = datetime.datetime.strptime(ph.completed_at, fmt)
                    break
                except ValueError:
                    pass
            if completed_dt:
                try:
                    deadline_dt = datetime.datetime.strptime(ph.deadline, "%Y-%m-%d")
                    diff = (completed_dt.date() - deadline_dt.date()).days
                    delay_days = max(0, diff)
                except Exception:
                    pass
        phase_items.append(PhaseReportItem(
            stage_index=ph.stage_index,
            stage_name=_get_current_stage_name(ph.stage_index),
            deadline=ph.deadline,
            completed_at=ph.completed_at,
            designer_update=ph.designer_update or "",
            delay_reason=ph.delay_reason or "",
            assigned_designer_ids=ph.assigned_designer_ids or [],
            is_current=ph.stage_index == project.stage_index,
            delay_days=delay_days,
        ))
    
    return ProjectReportResponse(
        project_id=project.id,
        project_name=project.name,
        assigned_designer=designer.name if designer else "Unassigned",
        start_date=project.start_date,
        deadline=project.deadline,
        status=project.status,
        progress=project.progress,
        stage_index=project.stage_index,
        phases=phase_items,
        stage_reports=[StageReportResponse.model_validate(r) for r in stage_reports],
        manager_notes=project.manager_notes or "",
        generated_at=datetime.utcnow().isoformat(),
    )


@app.get("/api/projects/{project_id}/weekly-report", response_model=WeeklyReportResponse)
async def get_project_weekly_report(
    project_id: int,
    week_start: str = Query(..., description="Week start date (YYYY-MM-DD)"),
    week_end: str = Query(..., description="Week end date (YYYY-MM-DD)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access reports")
    if user.role.upper() == "MANAGER":
        is_creator = project.created_by_user_id == user.id
        is_assigned = bool(
            db.query(ProjectManager).filter(
                ProjectManager.project_id == project_id,
                ProjectManager.manager_id == user.id,
            ).first()
        )
        if not is_creator and not is_assigned:
            raise HTTPException(status_code=403, detail="You can only access your own projects")
    
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    stage_reports = (
        db.query(StageReport)
        .filter(
            StageReport.project_id == project_id,
            StageReport.submitted_at >= week_start,
            StageReport.submitted_at <= week_end + "T23:59:59",
        )
        .all()
    )
    designer = (
        db.query(User).filter(User.id == project.assigned_designer_id).first()
        if project.assigned_designer_id else None
    )
    
    # Group reports by stage
    reports_by_stage = {}
    for r in stage_reports:
        reports_by_stage.setdefault(r.stage_index, []).append(StageReportResponse.model_validate(r))
    
    items = []
    for ph in phases:
        sr_list = reports_by_stage.get(ph.stage_index, [])
        items.append(WeeklyReportItem(
            project_id=project.id,
            project_name=project.name,
            assigned_designer=designer.name if designer else "Unassigned",
            stage_index=ph.stage_index,
            stage_name=_get_current_stage_name(ph.stage_index),
            status=project.status,
            progress=project.progress,
            deadline=ph.deadline,
            designer_update=ph.designer_update or "",
            delay_reason=ph.delay_reason or "",
            completed_at=ph.completed_at,
            stage_reports=sr_list,
        ))
    
    return WeeklyReportResponse(
        week_start=week_start,
        week_end=week_end,
        reports=items,
    )


@app.get("/api/projects/{project_id}/monthly-report", response_model=MonthlyReportResponse)
async def get_project_monthly_report(
    project_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020, le=2030),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role.upper() == "DESIGNER":
        raise HTTPException(status_code=403, detail="Designers cannot access reports")
    if user.role.upper() == "MANAGER":
        is_creator = project.created_by_user_id == user.id
        is_assigned = bool(
            db.query(ProjectManager).filter(
                ProjectManager.project_id == project_id,
                ProjectManager.manager_id == user.id,
            ).first()
        )
        if not is_creator and not is_assigned:
            raise HTTPException(status_code=403, detail="You can only access your own projects")
    
    month_start = f"{year}-{month:02d}-01"
    if month == 12:
        month_end = f"{year + 1}-01-01"
    else:
        month_end = f"{year}-{month + 1:02d}-01"
    
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
        .all()
    )
    stage_reports = (
        db.query(StageReport)
        .filter(
            StageReport.project_id == project_id,
            StageReport.submitted_at >= month_start,
            StageReport.submitted_at < month_end,
        )
        .all()
    )
    designer = (
        db.query(User).filter(User.id == project.assigned_designer_id).first()
        if project.assigned_designer_id else None
    )
    
    # Collect updates and delays per phase
    updates_by_phase = {}
    delays_by_phase = {}
    reports_by_phase = {}
    for r in stage_reports:
        idx = r.stage_index
        updates_by_phase.setdefault(idx, []).append(r.notes or "")
        if r.delay_days and r.delay_days > 0:
            delays_by_phase.setdefault(idx, []).append(f"{r.delay_days} days delay on {r.stage_name}")
        reports_by_phase.setdefault(idx, []).append(StageReportResponse.model_validate(r))
    
    items = []
    for ph in phases:
        idx = ph.stage_index
        items.append(MonthlyReportItem(
            project_id=project.id,
            project_name=project.name,
            assigned_designer=designer.name if designer else "Unassigned",
            stage_index=idx,
            stage_name=_get_current_stage_name(idx),
            status=project.status,
            progress=project.progress,
            deadline=ph.deadline,
            designer_updates=updates_by_phase.get(idx, []),
            delays=delays_by_phase.get(idx, []),
            stage_reports=reports_by_phase.get(idx, []),
        ))
    
    return MonthlyReportResponse(
        month=f"{month:02d}",
        year=year,
        reports=items,
    )


@app.get("/api/designers/{designer_id}/performance/weekly", response_model=DesignerPerformanceResponse)
async def get_designer_weekly_performance(
    designer_id: int,
    week_start: str = Query(..., description="Week start date (YYYY-MM-DD)"),
    week_end: str = Query(..., description="Week end date (YYYY-MM-DD)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    designer = db.query(User).filter(User.id == designer_id).first()
    if not designer:
        raise HTTPException(status_code=404, detail="Designer not found")
    
    projects = get_user_owned_project_query(db, user).all()
    designer_updates = (
        db.query(Phase)
        .join(Project)
        .filter(
            Project.id.in_([p.id for p in projects]),
            Phase.designer_update != "",
            Phase.designer_update.isnot(None),
        )
        .all()
    )
    
    # Count reports submitted by this designer in the week
    stage_reports = (
        db.query(StageReport)
        .filter(
            StageReport.submitted_by_user_id == str(designer_id),
            StageReport.submitted_at >= week_start,
            StageReport.submitted_at <= week_end + "T23:59:59",
        )
        .all()
    )
    
    total_updates = len(designer_updates)
    total_delays = sum(1 for r in stage_reports if r.delay_days and r.delay_days > 0)
    total_stages_completed = sum(1 for r in stage_reports if r.stage_completed)
    
    items = []
    for sr in stage_reports:
        proj = db.query(Project).filter(Project.id == sr.project_id).first()
        if proj:
            items.append(DesignerProjectItem(
                project_id=proj.id,
                project_name=proj.name,
                stage_index=sr.stage_index,
                stage_name=sr.stage_name,
                status=proj.status,
                progress=proj.progress,
                updates_count=1,
                delays_count=sr.delay_days if sr.delay_days and sr.delay_days > 0 else 0,
                reports_submitted=1,
            ))
    
    return DesignerPerformanceResponse(
        designer_id=designer.id,
        designer_name=designer.name,
        period_start=week_start,
        period_end=week_end,
        projects=items,
        total_updates=total_updates,
        total_delays=total_delays,
        total_stages_completed=total_stages_completed,
    )


@app.get("/api/designers/{designer_id}/performance/monthly", response_model=DesignerPerformanceResponse)
async def get_designer_monthly_performance(
    designer_id: int,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020, le=2030),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    designer = db.query(User).filter(User.id == designer_id).first()
    if not designer:
        raise HTTPException(status_code=404, detail="Designer not found")
    
    month_start = f"{year}-{month:02d}-01"
    if month == 12:
        month_end = f"{year + 1}-01-01"
    else:
        month_end = f"{year}-{month + 1:02d}-01"
    
    projects = get_user_owned_project_query(db, user).all()
    designer_updates = (
        db.query(Phase)
        .join(Project)
        .filter(
            Project.id.in_([p.id for p in projects]),
            Phase.designer_update != "",
            Phase.designer_update.isnot(None),
        )
        .all()
    )
    
    stage_reports = (
        db.query(StageReport)
        .filter(
            StageReport.submitted_by_user_id == str(designer_id),
            StageReport.submitted_at >= month_start,
            StageReport.submitted_at < month_end,
        )
        .all()
    )
    
    total_updates = len(designer_updates)
    total_delays = sum(1 for r in stage_reports if r.delay_days and r.delay_days > 0)
    total_stages_completed = sum(1 for r in stage_reports if r.stage_completed)
    
    items = []
    for sr in stage_reports:
        proj = db.query(Project).filter(Project.id == sr.project_id).first()
        if proj:
            items.append(DesignerProjectItem(
                project_id=proj.id,
                project_name=proj.name,
                stage_index=sr.stage_index,
                stage_name=sr.stage_name,
                status=proj.status,
                progress=proj.progress,
                updates_count=1,
                delays_count=sr.delay_days if sr.delay_days and sr.delay_days > 0 else 0,
                reports_submitted=1,
            ))
    
    return DesignerPerformanceResponse(
        designer_id=designer.id,
        designer_name=designer.name,
        period_start=month_start,
        period_end=month_end,
        projects=items,
        total_updates=total_updates,
        total_delays=total_delays,
        total_stages_completed=total_stages_completed,
    )


# ---------- Report download endpoints (CSV / Excel) ----------


def _project_report_to_csv(report: ProjectReportResponse) -> str:
    """Convert a ProjectReportResponse to CSV string."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Project", "Designer", "Start Date", "Deadline", "Status",
        "Progress", "Stage Index", "Manager Notes", "Generated At"
    ])
    writer.writerow([
        report.project_name, report.assigned_designer, report.start_date,
        report.deadline, report.status, report.progress, report.stage_index,
        report.manager_notes, report.generated_at
    ])
    writer.writerow([])
    writer.writerow(["Phase", "Stage Index", "Deadline", "Completed At", "Designer Update", "Delay Reason"])
    for p in report.phases:
        writer.writerow([
            p.stage_name, p.stage_index, p.deadline, p.completed_at or "",
            p.designer_update or "", p.delay_reason or ""
        ])
    writer.writerow([])
    writer.writerow(["Report ID", "Project", "Stage", "Stage Name", "Submitted By", "Submitted At",
                      "Costing", "Willingness to Buy", "Engagement Life", "Durability",
                      "Age Appropriateness", "Ease of Use", "Aesthetics", "Easy to Store", "Notes"])
    for sr in report.stage_reports:
        writer.writerow([
            sr.id, sr.project_id, sr.stage_index, sr.stage_name,
            sr.submitted_by_name, sr.submitted_at.strftime("%Y-%m-%d %H:%M") if sr.submitted_at else "",
            sr.costing, sr.willingness_to_buy, sr.engagement_life, sr.durability,
            sr.age_appropriateness, sr.ease_of_use, sr.aesthetics, sr.easy_to_store,
            sr.notes or ""
        ])
    return output.getvalue()


def _weekly_report_to_csv(report: WeeklyReportResponse) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Week Start", "Week End"])
    writer.writerow([report.week_start, report.week_end])
    writer.writerow([])
    writer.writerow(["Project", "Designer", "Stage", "Stage Index", "Status", "Progress",
                      "Designer Update", "Delay Reason", "Completed At"])
    for item in report.reports:
        writer.writerow([
            item.project_name, item.assigned_designer, item.stage_name,
            item.stage_index, item.status, item.progress,
            item.designer_update or "", item.delay_reason or "",
            item.completed_at or ""
        ])
    return output.getvalue()


def _monthly_report_to_csv(report: MonthlyReportResponse) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Month", "Year"])
    writer.writerow([report.month, report.year])
    writer.writerow([])
    writer.writerow(["Project", "Designer", "Stage", "Stage Index", "Status", "Progress",
                      "Designer Updates", "Delays"])
    for item in report.reports:
        updates = "; ".join(item.designer_updates) if item.designer_updates else ""
        delays = "; ".join(item.delays) if item.delays else ""
        writer.writerow([
            item.project_name, item.assigned_designer, item.stage_name,
            item.stage_index, item.status, item.progress,
            updates, delays
        ])
    return output.getvalue()


def _designer_performance_to_csv(report: DesignerPerformanceResponse) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Designer", "Period Start", "Period End", "Total Updates", "Total Delays", "Total Stages Completed"])
    writer.writerow([
        report.designer_name, report.period_start, report.period_end,
        report.total_updates, report.total_delays, report.total_stages_completed
    ])
    writer.writerow([])
    writer.writerow(["Project", "Stage", "Stage Index", "Status", "Progress", "Updates", "Delays", "Reports Submitted"])
    for item in report.projects:
        writer.writerow([
            item.project_name, item.stage_name, item.stage_index,
            item.status, item.progress, item.updates_count, item.delays_count,
            item.reports_submitted
        ])
    return output.getvalue()


@app.get("/api/reports/project/{project_id}/download")
async def download_project_report_csv(
    project_id: int,
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = await get_project_report(project_id, user, db)
    csv_content = _project_report_to_csv(report)
    if format == "xlsx":
        return JSONResponse(content={"message": "Excel export for project reports — use CSV for now"})
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="project-report-{project_id}.csv"'},
    )


@app.get("/api/reports/weekly/{project_id}/download")
async def download_weekly_report_csv(
    project_id: int,
    week_start: str = Query(...),
    week_end: str = Query(...),
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = await get_project_weekly_report(project_id, week_start, week_end, user, db)
    csv_content = _weekly_report_to_csv(report)
    if format == "xlsx":
        return JSONResponse(content={"message": "Excel export for weekly reports — use CSV for now"})
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="weekly-report-{project_id}.csv"'},
    )


@app.get("/api/reports/monthly/{project_id}/download")
async def download_monthly_report_csv(
    project_id: int,
    month: int = Query(...),
    year: int = Query(...),
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = await get_project_monthly_report(project_id, month, year, user, db)
    csv_content = _monthly_report_to_csv(report)
    if format == "xlsx":
        return JSONResponse(content={"message": "Excel export for monthly reports — use CSV for now"})
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="monthly-report-{project_id}.csv"'},
    )


@app.get("/api/reports/designer/{designer_id}/performance/download")
async def download_designer_performance_csv(
    designer_id: int,
    period: str = Query("weekly", regex="^(weekly|monthly)$"),
    week_start: Optional[str] = Query(None),
    week_end: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    format: str = Query("csv", regex="^(csv|xlsx)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if period == "weekly":
        report = await get_designer_weekly_performance(designer_id, week_start, week_end, user, db)
    else:
        report = await get_designer_monthly_performance(designer_id, month, year, user, db)
    csv_content = _designer_performance_to_csv(report)
    if format == "xlsx":
        return JSONResponse(content={"message": "Excel export for designer performance — use CSV for now"})
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="designer-performance-{designer_id}.csv"'},
    )


# ---------- Startup ----------


@app.on_event("startup")
def startup():
    if CRON_SECRET:
        scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True)
        scheduler_thread.start()
    else:
        logger.warning(
            "[SCHEDULER] CRON_SECRET not set — reminder scheduler disabled. "
            "Set CRON_SECRET and (optionally) point an external cron at "
            "POST /api/cron/tick to enable daily/deadline Slack reminders."
        )


# ---------- Serve Frontend ----------


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve index.html for all non-API routes (SPA fallback)."""
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    return FileResponse("index.html")
