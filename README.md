# Smartivity -- Little Sparks

## Product Design Project Management Platform

A full-stack web application for managing the end-to-end product design lifecycle at Smartivity (STEM education and toys). It connects Managers and Admins with Designers through a centralized dashboard and Slack integration, tracking progress across customizable workflow stages.

---

## Table of Contents

1. [Architecture & Tech Stack](#1-architecture--tech-stack)
2. [Project Structure](#2-project-structure)
3. [Roles & Permissions](#3-roles--permissions)
4. [Authentication](#4-authentication)
5. [Workflows & Stages](#5-workflows--stages)
6. [Dashboard](#6-dashboard)
7. [Projects](#7-projects)
8. [Designers](#8-designers)
9. [Slack Integration](#9-slack-integration)
10. [Reports](#10-reports)
11. [Data Export](#11-data-export)
12. [Stage Reports](#12-stage-reports)
13. [Environment Variables](#13-environment-variables)
14. [Deployment](#14-deployment)
15. [Local Development](#15-local-development)

---

## 1. Architecture & Tech Stack

| Layer | Technology |
|-------|-|
| **Frontend** | Vanilla JavaScript, TailwindCSS (CDN), Chart.js, Inter font |
| **Backend** | FastAPI (Python), SQLAlchemy ORM, Pydantic v2, wrapped for serverless via Mangum |
| **Database** | SQLite (local dev only), PostgreSQL via Supabase (production) |
| **Auth** | Session cookies (HttpOnly), argon2 password hashing, Slack OIDC with PKCE |
| **Slack** | Slack Bot (OAuth), Event Subscriptions (webhooks), Interactive Buttons, Modals |
| **Deployment** | Netlify — static frontend + one Python serverless function (`netlify/functions/api`) wrapping the whole FastAPI app; `netlify.toml` routes `/api/*` to it |

---

## 2. Project Structure

```
little-sparks/
├── index.html              # Single-page application (all views + modals)
├── styles.css              # Custom styles (scrollbar, animations, drag handles)
├── app.js                  # Frontend logic: auth, routing, CRUD, UI rendering
├── api.js                  # API client: all fetch calls to backend
├── utils.js                # Shared utilities: stage lists, formatting, toast
├── netlify.toml             # Netlify config: routes /api/* to the serverless function, SPA fallback
├── netlify/functions/api/   # Serverless function wrapping the FastAPI app (Mangum)
├── netlify/functions/reminder-cron/  # Scheduled function that triggers /api/cron/tick daily
├── .env.example            # Environment variable template
├── server/
│   ├── main.py             # FastAPI app, all endpoints, Slack bot logic
│   ├── models.py           # SQLAlchemy ORM models (User, Project, Phase, etc.)
│   ├── schemas.py          # Pydantic request/response schemas
│   ├── database.py         # Engine setup, migrations, session management
│   ├── requirements.txt    # Python dependencies
│   └── smartivity.db       # SQLite database (local)
├── smartivity.db           # SQLite database (root)
├── smartivity.log          # Application log (rotating, 10MB)
└── .gitignore
```

---

## 3. Roles & Permissions

| Role | Access |
|------|--------|
| **PENDING** | Account created but not yet approved. Cannot access dashboard. Shown a "Pending Approval" screen. |
| **ADMIN** | Full access: all projects, all users, user approval, data export, Slack config, reports. |
| **MANAGER** | Own projects only (created by or assigned to them). Can manage stages, designers, reports, Slack. |
| **DESIGNER** | No web dashboard access. Interacts exclusively through Slack bot in project channels. |

**Permission Matrix:**

| Feature | Admin | Manager | Designer |
|---------|-------|---------||
| View all projects | Yes | Own only | No |
| Create/Edit projects | Yes | Own only | No |
| Approve users | Yes | No | No |
| Manage designers | Yes | Yes | No |
| Mark stages complete | Yes | Yes | Via Slack |
| View Slack messages | Yes | Own projects | No |
| Configure Slack | Yes | Yes | No |
| Generate reports | Yes | Yes | No |
| Export data | Yes | Own only | No |

---

## 4. Authentication

### Email & Password
- Login via `/api/auth/login` with email and password
- Passwords hashed with **argon2**
- Session stored in HttpOnly cookie (`smartivity_session`)
- Sessions expire after 90 days

### Slack OIDC Login
- Login via `/api/auth/slack-auth-url` (Slack OAuth 2.0 + PKCE)
- Uses Slack's OpenID Connect for identity verification
- New Slack users are created with PENDING status
- State and nonce cookies prevent CSRF

### Session Management
- Session tokens: 48-byte random hex
- Cookie: HttpOnly, SameSite=lax (dev) / none (prod), secure flag
- Logout revokes the session token in the database

---

## 5. Workflows & Stages

The platform supports **two phase types**, each with its own set of workflow stages:

### PRODUCTION (9 stages)
| # | Stage |
|---|-------|
| 1 | Lock Concept |
| 2 | Lock UX features |
| 3 | Lock MRP |
| 4 | Lock graphics theme |
| 5 | Lock Production feasibility |
| 6 | Lock Procurement |
| 7 | Lock IM |
| 8 | Lock CCP |
| 9 | Final Handover |

### IDEATION (11 stages)
| # | Stage |
|---|-------|
| 1 | Sourcing Starts |
| 2 | Mockup 1 |
| 3 | Internal Discussion (Deeksha + Mentor + Rajat) |
| 4 | User Testing -1 Concluded |
| 5 | Mockup 2 - Internal Discussion |
| 6 | Sourcing Locked with Production |
| 7 | Costing Sheet Check |
| 8 | User Testing -2 |
| 9 | Internal Discussion |
| 10 | Sales Alignment for Launch Plan |
| 11 | Conclusion |

### Phase Customization
- Phase names are **editable** on both create and edit project pages
- Phases can be **reordered via drag-and-drop**
- Phases can be **added or removed** dynamically
- Phase type (IDEATION/PRODUCTION) is **read-only after creation**
- Each phase has its own deadline, start date constraints enforce ordering

### Project Status
| Status | Condition |
|--------|-|
| **ON_TRACK** | Project is progressing as planned |
| **DELAYED** | Current phase deadline has passed |
| **COMPLETED** | All stages finished (progress = 100%) |
| **AT_RISK** | Project approaching deadline |

---

## 6. Dashboard

The dashboard provides a high-level overview for Admin and Manager users:

### Summary Cards
- **Active Projects** — Total projects assigned to the user
- **On Time** — Projects with ON_TRACK status
- **Completed** — Projects with COMPLETED status
- **Delayed** — Projects with DELAYED status

### Charts
- **Project Status Distribution** — Doughnut chart showing On Time / Delayed / Completed breakdown
- **Delay Trend** — Line chart (dual-axis) showing total delay days and delayed project count over the last 6 months

### Overdue Projects
- List of all overdue projects sorted by days overdue
- Clickable rows navigate to project details

### Pending Requests (Admin only)
- Badge showing count of pending user approvals
- List with Approve as Designer / Approve as Manager / Reject actions

---

## 7. Projects

### Project List
- Filterable by phase type: **All**, **Ideation**, **Production**
- Columns: Name, Type, Designer, Current Stage, Progress, Deadline, Status, Actions
- Click row to view project details; Edit button for modifications

### Create Project
- Fields: Name, Assigned Designer, Project Managers (multi-select), Start Date, Expected Completion, Description
- **Phase Type** selection (Ideation or Production) with visual cards
- **Phase-wise Deadlines**: Each phase gets a name input and date input
- Phases support drag-and-drop reordering, add/remove
- Blank phase deadlines are auto-spaced between start and end dates
- The creating manager is auto-added to the project's manager list

### Project Details
- **Workflow Tracker**: Visual stepper showing all stages with completed/current/upcoming indicators
- **Stage Cards**: For each phase showing deadline, assigned designers, delay info, responsible parties
- **Actions per stage**: Mark Complete, Unmark, Assign Designers
- **Delay tracking**: Reason text + responsible user checkboxes (designers and managers)
- **Open Slack** button (shown when a Slack channel is connected)
- **Send Reminder** button triggers a manual Slack notification

### Edit Project
- Editable: Name, Designer, Managers, Dates, Description, Phase names, Phase deadlines
- Read-only: Phase Type, Current Phase Info (designer updates, delay reasons, completion timestamps)
- Phase reordering and add/remove work the same as create

---

## 8. Designers

- Grid view showing designer avatar (initials + color), name, and specialty
- **Add Designer**: Name + specialty (auto-generates email and default password `designer123`)
- **Remove Designer**: Confirmation dialog, removes from DB
- Designers are also used in the assignment modal within project stages

---

## 9. Slack Integration

### Configuration
- **Bot Token** (xoxb-...) and **Signing Secret** from Slack App settings
- **One-click workspace install** (Admin only) — redirects to Slack OAuth to install the bot
- Token rotation support: stored refresh tokens are proactively refreshed before expiry

### Project Channels
- Slack channel created automatically when a project is created
- Channel ID and name stored on the project record
- "Open Slack" button in project details opens the channel in Slack

### Interactive Features
- **Webhook setup** required: Event Subscriptions → `message.channels` bot event
- Designers interact via interactive buttons in Slack messages:
  - Complete Stage → Manager approval via Slack
  - Submit Report (8-category rating modal)
  - Report Delay (reason + responsible parties)
  - Update Notes (progress updates)
  - View Project (project info display)

### Slack Completion Tracker
- Designers can request stage completion via Slack message
- Managers approve via Slack message → auto-completes the stage
- Status flow: PENDING → CONFIRMED / CANCELLED

### Slack Messages Page
- View messages from connected project channels
- Auto-refreshes every 30 seconds
- Project selector dropdown

### Reminder System
- Daily check-in reminders at configurable hour (default: 10 AM IST)
- Deadline reminders per phase
- Manual reminder trigger from project details page
- External cron or in-process scheduler (checks every 300s)

---

## 10. Reports

Five report types available under **Performance Reports** in the sidebar:

### Project Report
- Select a project → generates a comprehensive report
- Charts: Phase Timeline, Quality Radar (8 categories), Delay Analysis by Stage
- Shows all phases with deadlines, completion dates, delays, designer updates

### Weekly Report
- Select project + week range
- Shows activities, stage completions, delays, progress changes for the week

### Monthly Report
- Select project + month/year
- Charts: 6-Month Rating & Delay Trend, Quality Radar, Delay Analysis
- Shows designer updates, delays, stage reports, submissions count

### Designer Performance
- Select designer + period (Weekly or Monthly)
- Shows per-project activity: updates, delays, completions
- Chart: Delay Trend over last 6 months

### Designer Comparison
- Cross-designer ranking by on-time rate, stages completed, delay days
- Available as part of the designer performance section

### Designer Performance Trend
- 6-month on-time rate trend per designer

### Report Downloads
- **CSV** download for any report
- **PDF** download for any report

---

## 11. Data Export

Admin-only section under Performance Reports → "Data" tab:

### Export Entities
- **Designers** — All designer accounts
- **Managers** — Admin and manager accounts
- **Projects** — Projects + all stages/phases
- **Everything** — All entities combined

### Formats
- CSV (single file or .zip for "Everything")
- PDF

### Custom Date Range
- Optional checkbox to filter exports by datetime range
- Applies to each record's created date

---

## 12. Stage Reports

Stage evaluation reports capture quality ratings across **8 categories** (1-5 scale):

| # | Category | What to Evaluate |
|---||-------|
| 1 | Costing | Is the product cost-effective for manufacturing? |
| 2 | Willingness to Buy | Would target customers purchase this? |
| 3 | Engagement Life | How long will it keep users engaged? |
| 4 | Durability | How well-built and long-lasting is it? |
| 5 | Age Appropriateness | Is it suitable for the target age group? |
| 6 | Ease of Use | How intuitive is it for the end user? |
| 7 | Aesthetics | How visually appealing is the design? |
| 8 | Easy to Store | How portable and storage-friendly is it? |

Reports can be submitted:
- **Via web**: Submit Report modal from project details
- **Via Slack**: Interactive button → modal form in Slack

Each report tracks: ratings, notes, actual completion date, delay days, and who submitted it.

---

## 13. Environment Variables

See `.env.example` for the full list:

| Variable | Description |
||---|
| `SECRET_KEY` | JWT signing key (generate with `secrets.token_urlsafe(48)`) |
| `ENCRYPTION_KEY` | Fernet key for Slack token encryption |
| `SLACK_CLIENT_ID` | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret |
| `SLACK_TEAM_ID` | Allowed Slack workspace team ID |
| `SLACK_REDIRECT_URI` | Slack OIDC callback URL |
| `SLACK_BOT_REDIRECT_URI` | Slack Bot install callback URL |
| `SLACK_BOT_SCOPES` | Bot OAuth scopes (comma-separated) |
| `SLACK_SIGNING_SECRET` | Slack App Signing Secret |
| `DATABASE_URL` | `sqlite:///./smartivity.db` or PostgreSQL DSN |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) |
| `FRONTEND_URL` | Frontend URL for Slack callback redirects |
| `CRON_SECRET` | Secret for triggering reminder cron endpoint |
| `DAILY_REMINDER_HOUR` | Hour for daily reminders (default: 10) |
| `REMINDER_TIMEZONE` | Timezone for reminders (default: Asia/Kolkata) |
| `SCHEDULER_INTERVAL_SECONDS` | Scheduler wake interval (default: 300) — only relevant for local/non-serverless runs |
| `ADMIN_EMAIL` | Seed admin email (must be set explicitly - no default) |
| `ADMIN_PASSWORD` | Seed admin password (must be set explicitly - no default) |
| `ADMIN_NAME` | Seed admin display name |
| `SERVERLESS` | Set to `true` on Netlify - switches DB engine to NullPool for serverless-safe connections |
| `SITE_URL` | Your Netlify site URL - used by the reminder-cron scheduled function to call back into the app |

---

## 14. Deployment

### Everything on Netlify
- Frontend: static files (`index.html`, `app.js`, etc.) served directly by Netlify's CDN
- Backend: `netlify/functions/api/api.py` wraps the entire FastAPI app via Mangum - all routes work unchanged, no per-route rewrite
- `netlify.toml` routes `/api/*` to the function; everything else falls back to `index.html` (SPA routing)
- Database: PostgreSQL via Supabase - use the **Transaction pooler** connection string (port 6543), not the direct connection (port 5432)
- Daily reminders: `netlify/functions/reminder-cron/` runs on a schedule and calls `POST /api/cron/tick` (idempotent - safe even if triggered more than once a day)
- Auto-migrations run on startup (adds missing columns/tables)
- Admin user seeded on first startup from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars (required, no built-in default)

---

## 15. Local Development

### Prerequisites
- Python 3.10+
- Node.js (optional, for any frontend tooling)

### Backend Setup
```bash
cd server
cp ../.env.example .env    # Fill in your values
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
- Open `index.html` directly in a browser, or serve with any static server
- API calls route to `http://localhost:8000/api` when on localhost

### Database
- SQLite database at `smartivity.db` (auto-created on first run)
- Migrations run automatically on startup (safe to run repeatedly)
- WAL mode enabled for SQLite concurrency

### Key Endpoints

| Method | Endpoint | Description |
|--------||---|
| POST | `/api/auth/login` | Email/password login |
| GET | `/api/auth/slack-auth-url` | Get Slack OIDC auth URL |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/auth/logout` | Logout |
| GET | `/api/admin/pending-users` | List pending users (Admin) |
| POST | `/api/admin/users/approve` | Approve user (Admin) |
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/dashboard/overdue-projects` | Overdue projects list |
| GET | `/api/dashboard/delay-trend` | 6-month delay trend |
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/{id}` | Project details |
| PUT | `/api/projects/{id}` | Update project |
| POST | `/api/projects/{id}/stages/{idx}/complete` | Mark stage complete |
| POST | `/api/projects/{id}/stages/{idx}/unmark` | Unmark stage |
| GET | `/api/projects/{id}/report` | Project report |
| GET | `/api/projects/{id}/weekly-report` | Weekly report |
| GET | `/api/projects/{id}/monthly-report` | Monthly report |
| GET | `/api/projects/{id}/monthly-trend` | 6-12 month trend |
| GET | `/api/designers` | List designers |
| POST | `/api/designers` | Add designer |
| DELETE | `/api/designers/{id}` | Remove designer |
| GET | `/api/reports/designer-comparison` | Cross-designer ranking |
| GET | `/api/designers/{id}/performance/weekly` | Designer weekly performance |
| GET | `/api/designers/{id}/performance/monthly` | Designer monthly performance |
| GET | `/api/designers/{id}/performance/trend` | 6-month performance trend |
| GET/POST | `/api/slack/config` | Slack config |
| POST | `/api/slack/install` | Slack bot install redirect |
| POST | `/api/slack/webhook` | Slack event webhook |
| GET | `/api/projects/{id}/slack-messages` | Slack messages for project |
| GET | `/api/projects/{id}/slack-activity` | Slack activity log |
| POST | `/api/reports` | Submit stage report |
| GET | `/api/reports/summary` | Report summary |
| GET | `/api/admin/export/{entity}` | Export data (CSV/PDF) |
| POST | `/api/projects/{id}/remind` | Send manual reminder |

---

*Last Updated: August 2026*
