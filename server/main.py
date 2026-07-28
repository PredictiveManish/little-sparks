from fastapi import FastAPI, Depends, HTTPException, status, Request, Cookie, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
from jose import jwt
from itsdangerous import Signer, BadSignature
from cryptography.fernet import Fernet, InvalidToken
import argon2
import hashlib
import re
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
    WhatsAppMessage,
    SlackConfig,
    SlackActivity,
    SlackMessage,
    Session as SessionModel,
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
    WhatsAppMessageCreate,
    WhatsAppMessageResponse,
    SlackConfigCreate,
    SlackConfigResponse,
    SlackActivityResponse,
    SlackChannelCreateResponse,
    SlackStatusResponse,
    SlackLoginRequest,
    PendingUserResponse,
    ApproveUserRequest,
    SlackMessageResponse,
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
    projects = db.query(Project).all()
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
    projects = db.query(Project).order_by(Project.created_at.desc()).limit(5).all()
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
        db.query(Project)
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
    projects = db.query(Project).all()
    result = []
    for p in projects:
        phases = (
            db.query(Phase)
            .filter(Phase.project_id == p.id)
            .order_by(Phase.stage_index)
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
                priority=p.priority,
                manager_notes=p.manager_notes,
                phases=[PhaseResponse.model_validate(ph) for ph in phases],
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
    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
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
        priority=project.priority,
        manager_notes=project.manager_notes,
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
    )


@app.post("/api/projects", response_model=ProjectResponse, status_code=201)
def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
        start_date=data.start_date,
        deadline=data.deadline,
        priority=data.priority,
        manager_notes=data.manager_notes,
    )
    db.add(project)
    db.flush()

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
        async with SessionLocal() as bg_db:
            try:
                await notify_project_created(bg_db, project.id, user.slack_user_id)
            except Exception:
                pass

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
        priority=project.priority,
        manager_notes=project.manager_notes,
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
    )


@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    data: ProjectUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    changes = []
    if data.name is not None and data.name != project.name:
        changes.append(f"Name: {project.name} → {data.name}")
        project.name = data.name
    if data.description is not None and data.description != project.description:
        changes.append(f"Description updated")
        project.description = data.description
    if data.priority is not None and data.priority != project.priority:
        changes.append(f"Priority: {project.priority} → {data.priority}")
        project.priority = data.priority
    if data.deadline is not None and data.deadline != project.deadline:
        changes.append(f"Deadline: {project.deadline} → {data.deadline}")
        project.deadline = data.deadline
    if data.manager_notes is not None and data.manager_notes != project.manager_notes:
        changes.append(f"Manager notes updated")
        project.manager_notes = data.manager_notes

    if changes:
        db.commit()
        db.refresh(project)

        designer = (
            db.query(User).filter(User.id == project.assigned_designer_id).first()
        )
        designer_name = designer.name if designer else "Unassigned"
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        current_stage = _get_current_stage_name(project.stage_index)

        changes_text = "\n".join([f"• {c}" for c in changes])
        notify = (
            f"📝 *Project Updated*\n\n"
            f"*{project.name}*\n\n"
            f"👤 Designer: {designer_name}\n"
            f"🔄 Current Stage: {current_stage}\n"
            f"📊 Progress: {project.progress}%\n\n"
            f"*Changes:*\n{changes_text}\n\n"
            f"Updated at: {now_str}"
        )

        msg = WhatsAppMessage(
            project_id=project_id,
            content=notify,
            is_sent=False,
            timestamp=now_str,
            quick_replies=["📊 View Progress", "📦 Project Info", "🔙 Main Menu"],
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
    else:
        db.commit()
        db.refresh(project)

    phases = (
        db.query(Phase)
        .filter(Phase.project_id == project_id)
        .order_by(Phase.stage_index)
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
        priority=project.priority,
        manager_notes=project.manager_notes,
        phases=[PhaseResponse.model_validate(ph) for ph in phases],
    )


@app.post("/api/projects/{project_id}/stages/{stage_index}/complete")
async def complete_stage(
    project_id: int,
    stage_index: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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

    msg = WhatsAppMessage(
        project_id=project_id,
        content=notify,
        is_sent=False,
        timestamp=now_str,
        quick_replies=["📊 View Progress", "📦 Project Info", "🔄 Stage Update"],
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

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

    msg = WhatsAppMessage(
        project_id=project_id,
        content=notify,
        is_sent=False,
        timestamp=now_str,
        quick_replies=["📊 View Progress", "✅ Complete Stage", "📦 Project Info"],
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return {"message": "Stage unmarked"}


# ---------- Designers ----------


@app.get("/api/designers", response_model=List[UserResponse])
def get_designers(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    users = db.query(User).filter(User.role == "DESIGNER").all()
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == designer_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Designer not found")

    db.query(Project).filter(Project.assigned_designer_id == designer_id).update(
        {"assigned_designer_id": None}
    )
    db.query(Phase).delete()
    db.query(WhatsAppMessage).delete()

    db.delete(user)
    db.commit()
    return {"message": "Designer removed"}


# ---------- WhatsApp Messages ----------


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


def _generate_bot_response(db, project_id, user_message):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        return None, "❌ Project not found. Please check the project ID."

    msg_lower = user_message.strip().lower()
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    designer_name = designer.name if designer else "Unassigned"

    if any(
        kw in msg_lower
        for kw in [
            "project info",
            "project details",
            "tell me about",
            "project status",
            "status",
        ]
    ):
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        stages_completed = sum(1 for p in phases if p.completed_at)
        total_stages = len(phases)
        current_stage = _get_current_stage_name(project.stage_index)
        days_left = (
            datetime.strptime(project.deadline, "%Y-%m-%d") - datetime.now()
        ).days
        reply = (
            f"📦 *Project: {project.name}*\n\n"
            f"👤 Designer: {designer_name}\n"
            f"📊 Progress: {project.progress}%\n"
            f"🔄 Current Stage: {current_stage}\n"
            f"📅 Deadline: {project.deadline} ({days_left} days left)\n"
            f"⚡ Priority: {project.priority}\n"
            f"📌 Status: {project.status.replace('_', ' ')}\n\n"
            f"✅ {stages_completed}/{total_stages} stages completed"
        )
        return reply, "What would you like to do?"

    if any(
        kw in msg_lower
        for kw in ["stage update", "current stage", "what stage", "where we are"]
    ):
        current_stage = _get_current_stage_name(project.stage_index)
        current_phase = (
            phases[project.stage_index] if project.stage_index < len(phases) else None
        )
        deadline = current_phase.deadline if current_phase else "N/A"
        reply = (
            f"🔄 *Current Stage: {current_stage}*\n\n"
            f"📅 Deadline: {deadline}\n"
            f"👤 Assigned: {designer_name}\n"
            f"📊 Progress: {project.progress}%\n\n"
            f"Reply with:\n*1* — Mark stage complete\n*2* — Report delay\n*3* — Update notes"
        )
        return reply, ["✅ Complete Stage", "⚠️ Report Delay", "📝 Update Notes"]

    if any(
        kw in msg_lower
        for kw in ["mark complete", "stage complete", "completed", "done", "finished"]
    ):
        if project.stage_index >= len(phases):
            return None, "🎉 All stages are already complete!"
        prev_phase = (
            phases[project.stage_index - 1] if project.stage_index > 0 else None
        )
        if project.stage_index > 0 and not prev_phase.completed_at:
            prev_name = _get_current_stage_name(project.stage_index - 1)
            return (
                None,
                f"❌ Complete *{prev_name}* first before moving to the next stage.",
            )
        now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
        phases[project.stage_index].completed_at = now
        total = len(phases)
        completed = sum(1 for ph in phases if ph.completed_at)
        project.progress = round((completed / total) * 100)
        project.stage_index = min(project.stage_index + 1, total - 1)
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if project.progress == 100:
            project.status = "COMPLETED"
        elif project.deadline < today_str:
            project.status = "DELAYED"
        else:
            project.status = "ON_TRACK"
        db.commit()
        new_stage = _get_current_stage_name(project.stage_index)
        if project.progress == 100:
            reply = (
                f"🎉 *Congratulations!*\n\n"
                f"Project *{project.name}* is now 100% complete!\n"
                f"All {total} stages have been marked as done."
            )
        else:
            reply = (
                f"✅ *Stage Complete!*\n\n"
                f"Moved to next stage: *{new_stage}*\n"
                f"📊 Total Progress: {project.progress}%\n\n"
                f"Reply with 'stage update' for more details."
            )
        return reply, ["📊 View Progress", "📦 Project Info", "🔙 Main Menu"]

    if any(
        kw in msg_lower
        for kw in ["delay", "behind", "late", "cannot complete", "will miss"]
    ):
        reply = (
            f"⚠️ *Delay Reported*\n\n"
            f"Please reply with:\n"
            f"1. Reason for delay\n"
            f"2. Revised deadline (YYYY-MM-DD)\n\n"
            f"Example: 'Need more time for graphics, revised date 2025-02-15'"
        )
        return reply, "Waiting for your response..."

    if "reason" in msg_lower or "revised" in msg_lower or "more time" in msg_lower:
        reason_match = re.search(
            r"(?:reason|because|since|due to)[:\s]+(.+?)(?:\n|$)", msg_lower
        )
        revised_match = re.search(
            r"(?:revised|new|new date|date)[:\s]+(\d{4}-\d{2}-\d{2})", msg_lower
        )
        reason = reason_match.group(1).strip() if reason_match else "No reason provided"
        revised_date = revised_match.group(1) if revised_match else "TBD"
        if phases[project.stage_index]:
            phases[
                project.stage_index
            ].delay_reason = f"{reason} (Revised: {revised_date})"
            db.commit()
        reply = (
            f"⚠️ *Delay Acknowledged*\n\n"
            f"📋 Reason: {reason}\n"
            f"📅 Revised Deadline: {revised_date}\n\n"
            f"The project manager has been notified."
        )
        return reply, ["📊 View Status", "📦 Project Info", "🔙 Main Menu"]

    if any(
        kw in msg_lower
        for kw in ["update notes", "update", "add note", "progress update"]
    ):
        reply = (
            f"📝 *Update Notes*\n\n"
            f"Please type your update/progress note below.\n"
            f"It will be logged to the current stage."
        )
        return reply, "Waiting for your note..."

    if "update" in msg_lower or "note" in msg_lower or "progress" in msg_lower:
        if phases[project.stage_index]:
            phases[project.stage_index].designer_update = user_message
            db.commit()
        reply = (
            f"✅ *Note Updated!*\n\n"
            f"Your update has been logged to the current stage.\n\n"
            f"Current stage: {_get_current_stage_name(project.stage_index)}"
        )
        return reply, ["📊 View Progress", "📦 Project Info", "🔙 Main Menu"]

    if any(kw in msg_lower for kw in ["progress", "how far", "how much", "completion"]):
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        stages_completed = sum(1 for p in phases if p.completed_at)
        total_stages = len(phases)
        current_stage = _get_current_stage_name(project.stage_index)
        reply = (
            f"📊 *Progress Report*\n\n"
            f"Project: {project.name}\n"
            f"Total Progress: {project.progress}%\n"
            f"Current Stage: {current_stage}\n\n"
            f"Stage Breakdown:\n"
        )
        for i, phase in enumerate(phases):
            check = "✅" if phase.completed_at else "⬜"
            marker = " ➜" if i == project.stage_index else ""
            reply += f"{check} {i + 1}. {phase.deadline}{marker}\n"
        reply += f"\n📅 Deadline: {project.deadline}"
        return reply, ["📦 Project Info", "✅ Complete Stage", "🔙 Main Menu"]

    if any(
        kw in msg_lower
        for kw in ["all projects", "list projects", "my projects", "show projects"]
    ):
        all_projects = db.query(Project).all()
        if not all_projects:
            return None, "No projects found."
        reply = "📦 *Your Projects:*\n\n"
        for p in all_projects:
            d = db.query(User).filter(User.id == p.assigned_designer_id).first()
            d_name = d.name if d else "Unassigned"
            reply += f"{'✅' if p.progress == 100 else '🔄'} {p.name} — {p.progress}% ({d_name})\n"
        return reply, "Reply with a project name for details."

    if any(
        kw in msg_lower for kw in ["help", "menu", "options", "what can", "commands"]
    ):
        reply = (
            f"🤖 *Smartivity Bot — Available Commands:*\n\n"
            f"*📦 Project Info* — View project details\n"
            f"*🔄 Stage Update* — Current stage info\n"
            f"*✅ Complete Stage* — Mark current stage done\n"
            f"*⚠️ Delay* — Report a delay\n"
            f"*📝 Update Notes* — Log progress notes\n"
            f"*📊 Progress* — View progress breakdown\n"
            f"*📋 All Projects* — List all projects\n"
            f"*❓ Help* — Show this menu\n\n"
            f"Type any of these to get started!"
        )
        return reply, [
            "📦 Project Info",
            "🔄 Stage Update",
            "📊 Progress",
            "📋 All Projects",
        ]

    if any(
        kw in msg_lower
        for kw in ["hello", "hi", "hey", "good morning", "good afternoon"]
    ):
        return (
            None,
            f"👋 Hello! How can I help you today?\n\nReply with *help* to see available commands.",
        )

    current_stage = _get_current_stage_name(project.stage_index)
    return None, (
        f"🤖 I didn't quite understand that.\n\n"
        f"Current stage: *{current_stage}*\n"
        f"Reply with *help* to see available commands."
    )


@app.get(
    "/api/projects/{project_id}/whatsapp-messages",
    response_model=List[WhatsAppMessageResponse],
)
def get_whatsapp_messages(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    messages = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.project_id == project_id)
        .order_by(WhatsAppMessage.created_at)
        .all()
    )
    return [WhatsAppMessageResponse.model_validate(m) for m in messages]


@app.post(
    "/api/projects/{project_id}/whatsapp-messages",
    response_model=WhatsAppMessageResponse,
    status_code=201,
)
def create_whatsapp_message(
    project_id: int,
    data: WhatsAppMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="Project not found")

    msg = WhatsAppMessage(
        project_id=project_id,
        content=data.content,
        is_sent=data.is_sent,
        timestamp=data.timestamp,
        quick_replies=data.quick_replies,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return WhatsAppMessageResponse.model_validate(msg)


@app.post("/api/projects/{project_id}/whatsapp-messages/respond")
def bot_respond(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    last_user_msg = (
        db.query(WhatsAppMessage)
        .filter(
            WhatsAppMessage.project_id == project_id, WhatsAppMessage.is_sent == True
        )
        .order_by(WhatsAppMessage.created_at.desc())
        .first()
    )
    if not last_user_msg:
        raise HTTPException(status_code=400, detail="No user message to respond to")

    bot_content, quick_replies = _generate_bot_response(
        db, project_id, last_user_msg.content
    )
    if bot_content is None:
        bot_content = quick_replies
        quick_replies = []

    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    bot_msg = WhatsAppMessage(
        project_id=project_id,
        content=bot_content,
        is_sent=False,
        timestamp=now_str,
        quick_replies=quick_replies,
    )
    db.add(bot_msg)
    db.commit()
    db.refresh(bot_msg)
    return WhatsAppMessageResponse.model_validate(bot_msg)


@app.post("/api/projects/{project_id}/whatsapp-messages/welcome")
def send_welcome_message(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project, designer, phases = _get_project_details(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing = (
        db.query(WhatsAppMessage)
        .filter(
            WhatsAppMessage.project_id == project_id,
            WhatsAppMessage.content.contains("Welcome"),
        )
        .first()
    )
    if existing:
        return None

    designer_name = designer.name if designer else "Unassigned"
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    current_stage = _get_current_stage_name(project.stage_index)

    welcome = (
        f"👋 Welcome to *Smartivity Bot*!\n\n"
        f"📦 Project: *{project.name}*\n"
        f"👤 Designer: {designer_name}\n"
        f"📅 Deadline: {project.deadline}\n"
        f"⚡ Priority: {project.priority}\n"
        f"📊 Progress: {project.progress}%\n\n"
        f"Current Stage: *{current_stage}*\n\n"
        f"Type *help* to see all available commands!"
    )

    msg = WhatsAppMessage(
        project_id=project_id,
        content=welcome,
        is_sent=False,
        timestamp=now_str,
        quick_replies=["📦 Project Info", "🔄 Stage Update", "📊 Progress", "❓ Help"],
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return WhatsAppMessageResponse.model_validate(msg)


# ---------- Slack Integration ----------


def get_slack_config(db):
    config = db.query(SlackConfig).first()
    return config


def verify_slack_signature(timestamp, signature, body, signing_secret):
    if abs(datetime.utcnow().timestamp() - int(timestamp)) > 60 * 5:
        logger.warning(
            "[SLACK WEBHOOK] Request timestamp expired | timestamp=%s | current=%s | diff=%ss",
            timestamp,
            int(datetime.utcnow().timestamp()),
            abs(datetime.utcnow().timestamp() - int(timestamp)),
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
            "[SLACK WEBHOOK] Signature verification failed | timestamp=%s | signature=%s... | expected=%s...",
            timestamp,
            signature[:20] if signature else "None",
            sig_b64[:20],
        )
    return match


async def slack_api_call(db, endpoint, data=None):
    config = get_slack_config(db)
    if not config:
        logger.warning("[SLACK API] No Slack config found | endpoint=%s", endpoint)
        return None
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
        return None
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
                logger.warning(
                    "[SLACK API] %s returned error | status=%s | error=%s | response=%s",
                    endpoint,
                    response.status_code,
                    result.get("error"),
                    json.dumps(result)[:500],
                )
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


async def invite_users_to_channel(db, channel_id, slack_user_ids):
    """Invite Slack users to a channel. Skips empty IDs silently."""
    valid = [uid for uid in slack_user_ids if uid]
    if not valid:
        return
    await slack_api_call(db, "conversations.invite", {
        "channel": channel_id,
        "users": ",".join(valid)
    })


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


async def notify_project_created(db, project_id, manager_slack_user_id=""):
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
            designer_slack_id = designer.slack_user_id if designer else ""
            await invite_users_to_channel(db, result["channel"]["id"], [manager_slack_user_id, designer_slack_id])
        else:
            return
    channel_id = project.slack_channel_id
    designer_name = designer.name if designer else "Unassigned"
    stage_list = ""
    for i, phase in enumerate(phases):
        stage_list += f"  {i + 1}. {phase.deadline}\n"
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📦 New Project: {project.name}"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"👤 *Designer:* {designer_name}\n"
                    f"📅 *Start:* {project.start_date}\n"
                    f"📅 *Deadline:* {project.deadline}\n"
                    f"⚡ *Priority:* {project.priority}\n\n"
                    f"*9-Stage Workflow:*\n{stage_list}"
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
        db, project_id, f"New project assigned: {project.name}", blocks, channel_id
    )


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
                f"⚡ *Priority:* {project.priority}\n"
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
    logger.info(
        "[SLACK INSTALL] oauth.v2.access success | team_id=%s | access_token=%s...",
        team_id,
        bot_token[:10] if bot_token else "None",
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
    messages = (
        db.query(SlackMessage)
        .filter(SlackMessage.project_id == project_id)
        .order_by(SlackMessage.created_at.desc())
        .limit(100)
        .all()
    )
    return [SlackMessageResponse.model_validate(m) for m in messages]


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
                    logger.info(
                        "[SLACK WEBHOOK] complete_stage action | project_id=%s | stage_idx=%s",
                        project_id,
                        stage_idx,
                    )
                    stage_idx = int(value)
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
    channel_name = f"project-{project.name.lower().replace(' ', '-')}"
    logger.info(
        "[SLACK CHANNEL] Creating Slack channel | project=%s | channel_name=%s",
        project.name,
        channel_name,
    )
    result = await slack_api_call(
        db, "conversations.create", {"name": channel_name, "is_private": False}
    )
    if result and result.get("ok"):
        channel_id = result["channel"]["id"]
        project.slack_channel_id = channel_id
        project.slack_channel_name = channel_name
        db.commit()
        designer = db.query(User).filter(User.id == project.assigned_designer_id).first()
        designer_slack_id = designer.slack_user_id if designer else ""
        await invite_users_to_channel(db, channel_id, [user.slack_user_id, designer_slack_id])
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
    activities = (
        db.query(SlackActivity)
        .filter(SlackActivity.project_id == project_id)
        .order_by(SlackActivity.created_at.desc())
        .limit(50)
        .all()
    )
    return [SlackActivityResponse.model_validate(a) for a in activities]


# ---------- Startup ----------


@app.on_event("startup")
def startup():
    pass


# ---------- Serve Frontend ----------


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve index.html for all non-API routes (SPA fallback)."""
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    return FileResponse("index.html")
