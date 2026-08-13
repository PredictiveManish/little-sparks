# Smartivity -- Little Sparks
## User Documentation

A Product Design Project Management Platform

---

## Table of Contents

1. [Getting Started](#1-getting-started)
   - [1.1 What is Smartivity?](#11-what-is-smartivity)
   - [1.2 System Requirements](#12-system-requirements)
   - [1.3 Logging In](#13-logging-in)
   - [1.4 Account Approval Process](#14-account-approval-process)
2. [Dashboard Overview](#2-dashboard-overview)
   - [2.1 Dashboard Layout](#21-dashboard-layout)
   - [2.2 Summary Statistics](#22-summary-statistics)
   - [2.3 Pending Requests](#23-pending-requests)
3. [Admin Guide](#3-admin-guide)
   - [3.1 Admin Overview](#31-admin-overview)
   - [3.2 Managing User Accounts](#32-managing-user-accounts)
   - [3.3 Managing Projects](#33-managing-projects)
   - [3.4 Managing Designers](#34-managing-designers)
   - [3.5 Slack Configuration](#35-slack-configuration)
   - [3.6 Data & Reports Export](#36-data--reports-export)
   - [3.7 Slack Messages](#37-slack-messages)
4. [Manager Guide](#4-manager-guide)
   - [4.1 Manager Overview](#41-manager-overview)
   - [4.2 Creating a New Project](#42-creating-a-new-project)
   - [4.3 Managing Your Projects](#43-managing-your-projects)
   - [4.4 Project Details & Workflow](#44-project-details--workflow)
   - [4.5 Stage Evaluation Reports](#45-stage-evaluation-reports)
   - [4.6 Managing Designers](#46-managing-designers)
   - [4.7 Slack Configuration](#47-slack-configuration)
   - [4.8 Slack Messages](#48-slack-messages)
   - [4.9 Data & Reports Export](#49-data--reports-export)
5. [Designer Guide](#5-designer-guide)
   - [5.1 Designer Overview](#51-designer-overview)
   - [5.2 First-Time Login](#52-first-time-login)
   - [5.3 Working Through Slack](#53-working-through-slack)
   - [5.4 Daily Check-Ins](#54-daily-check-ins)
   - [5.5 Completing a Stage](#55-completing-a-stage)
   - [5.6 Submitting Stage Reports](#56-submitting-stage-reports)
   - [5.7 Reporting Delays](#57-reporting-delays)
   - [5.8 Updating Notes](#58-updating-notes)
   - [5.9 Viewing Project Information](#59-viewing-project-information)
6. [The 9-Stage Workflow](#6-the-9-stage-workflow)
   - [6.1 Stage Overview](#61-stage-overview)
   - [6.2 Stage Progression](#62-stage-progression)
7. [Troubleshooting](#7-troubleshooting)
8. [Support](#8-support)

---

## 1. Getting Started

### 1.1 What is Smartivity?

Smartivity -- Little Sparks is a **Product Design Project Management Platform** built for Smartivity, a STEM education and toy company. It manages the **end-to-end product design lifecycle** from initial concept through final handover.

The platform connects **Managers** and **Admins** with **Designers** through a centralized dashboard and Slack integration, streamlining communication and tracking progress across all product design stages.

**Key Features:**
- Real-time project tracking across 9 development stages
- Designer performance evaluation with 8 rating categories
- Automated Slack notifications and reminders
- Deadline management with status alerts
- Data export and reporting
- Role-based access control

### 1.2 System Requirements

- **Browser:** Chrome 90+, Firefox 88+, Edge 90+, Safari 14+
- **Internet Connection:** Required for web dashboard and Slack integration
- **Slack Account:** Required for Designers to interact with the platform
- **Device:** Desktop or laptop recommended (responsive for tablets)

### 1.3 Logging In

Users can log in to Smartivity in **two ways:**

**Option 1: Email & Password**
1. Navigate to the Smartivity login page
2. Enter your registered email address
3. Enter your password
4. Click **Sign In**

**Option 2: Slack OAuth**
1. Click the **Sign in with Slack** button on the login page
2. You will be redirected to your Slack workspace for authorization
3. After granting permission, you will be redirected back to Smartivity

> **Note:** If you are a new user, your account will be in **Pending Approval** status until an Admin reviews and approves your request.

### 1.4 Account Approval Process

When you first register or log in via Slack, your account status is **Pending Approval**.

**What you will see:**
- A screen stating **"Account Pending Approval"**
- No access to Dashboard, Projects, or other features
- You can continue to log in, but features remain locked

**What happens next:**
1. An **Admin** reviews your pending account
2. The Admin approves your request and assigns you a role:
   - **Designer** -- for product design team members
   - **Manager** -- for project management team members
3. Once approved, you can access the platform with your assigned permissions

**Designer Password:** When a Designer account is approved, a default password is set. Check with your Admin for your login credentials.

---

## 2. Dashboard Overview

The Dashboard is the **landing page** for authenticated Admin and Manager users. It provides a high-level overview of all projects, deadlines, and system status.

> **[SCREENSHOT: Dashboard Overview]**
> *Insert screenshot showing the full Dashboard layout with all panels visible*

### 2.1 Dashboard Layout

The Dashboard is organized into the following sections:

| Section | Location | Description |
|---------|----------|-------------|
| **Navigation Sidebar** | Left side | Menu for accessing all platform sections |
| **Summary Statistics** | Top row | 4 cards showing key project metrics |
| **Pending Requests** | Below stats (Admin only) | User approval management |

### 2.2 Summary Statistics

Four summary cards at the top of the Dashboard display key metrics:

**1. Active Projects**
- Shows the total number of projects currently assigned to you (Manager) or across the organization (Admin)

**2. On Time**
- Count of projects with status **ON_TRACK**
- Projects progressing as planned

**3. Completed**
- Count of projects with status **COMPLETED**
- Projects that have finished all 9 stages

**4. Delayed**
- Count of projects with status **DELAYED**
- Projects that have missed their deadlines

> **[SCREENSHOT: Summary Statistics Cards]**
> *Insert screenshot showing the 4 summary stat cards at the top of the Dashboard*

### 2.3 Pending Requests

> **This section is only visible to Admin users.**

When new users register or log in via Slack, their accounts appear here as pending approvals.

**What you will see:**
- A badge showing the **number of pending accounts**
- A list of each pending user with:
  - Name
  - Email address
  - Requested role

**Actions available:**
- **Approve as Designer** -- Approves the user and assigns the Designer role
- **Approve as Manager** -- Approves the user and assigns the Manager role
- **Reject** -- Declines the registration request

> **[SCREENSHOT: Pending Requests Panel]**
> *Insert screenshot showing the Pending Requests section with user list and action buttons*


---

## 3. Admin Guide

### 3.1 Admin Overview

Admins have **full access** to all features and data across the Smartivity platform. This section covers all Admin-specific capabilities.

**Admin Permissions:**
- View and manage **all projects** across the organization
- Approve or reject **pending user accounts**
- Create, edit, and delete **projects**
- Add and remove **designers**
- Configure **Slack integration** settings
- Send **reminders** to designers
- Export **all data** (CSV/Excel)
- View **all reports** and analytics
- View **Slack messages** from all project channels

### 3.2 Managing User Accounts

Admins are responsible for approving new user registrations.

**To manage pending accounts:**

1. Navigate to the **Dashboard**
2. Scroll to the **Pending Requests** section
3. Review each pending user's:
   - Name
   - Email
   - Requested role
4. Choose an action:

| Action | What it does |
|--------|--------------|
| **Approve as Designer** | Approves the user and assigns the Designer role. They will be able to interact with projects through Slack. |
| **Approve as Manager** | Approves the user and assigns the Manager role. They will be able to create and manage projects. |
| **Reject** | Declines the registration. The user will not be able to access the platform. |

> **[SCREENSHOT: Admin Approval Page]**
> *Insert screenshot showing the admin approval page with pending users list and action buttons*

### 3.3 Managing Projects

Admins can create, view, edit, and manage all projects in the system.

**To view all projects:**
1. Click **Projects** in the left sidebar
2. The Projects page displays a table with:
   - Project name
   - Assigned designer
   - Current stage
   - Progress percentage
   - Deadline date
   - Status (ON_TRACK, DELAYED, COMPLETED, AT_RISK)

**To create a new project:**
1. Click the **Create Project** button
2. Fill in the project details:
   - Project name
   - Phase deadlines (for each of the 9 stages)
   - Assigned designers
   - Description and priority
3. Click **Create Project**

**To edit a project:**
1. Click the **Edit** button on any project row
2. Update the desired fields
3. Click **Save Changes**

> **[SCREENSHOT: Projects Page]**
> *Insert screenshot showing the Projects table with all columns and action buttons*

### 3.4 Managing Designers

Admins can add or remove designers from the platform.

**To add a designer:**
1. Click **Designers** in the left sidebar
2. Click **Add Designer**
3. Enter the designer's:
   - Name
   - Email address
4. Click **Add**

**To remove a designer:**
1. Navigate to the **Designers** page
2. Find the designer in the grid
3. Click the **Remove** button on their card

> **[SCREENSHOT: Designers Page]**
> *Insert screenshot showing the Designers grid with add/remove buttons*

### 3.5 Slack Configuration

Admins can configure the Slack integration that enables communication with designers.

**To configure Slack:**
1. Click **Slack Settings** in the left sidebar
2. Configure your Slack credentials:
   - Slack App Token
   - Bot User OAuth Token
   - Signing Secret
3. Set up **webhook URL** for receiving Slack interactions
4. Create or manage **project channels**

**Key Slack Features:**
- Automatic channel creation for each project
- Daily check-in reminders at 10 AM IST
- Deadline reminders
- Interactive buttons for designers to complete stages, submit reports, and more

> **[SCREENSHOT: Slack Settings Page]**
> *Insert screenshot showing the Slack configuration page with credential fields*

### 3.6 Data & Reports Export

Admins can export all platform data for analysis and record-keeping.

**To export data:**
1. Click **Data & Reports** in the left sidebar
2. Choose what to export:
   - Designers
   - Managers
   - Projects
   - Stage Evaluation Reports
3. Select format: **CSV** or **Excel**
4. Click **Export**

**Stage Evaluation Reports:**
- Filter by project, designer, stage, or date range
- View in **Table** or **Summary** format
- Includes 8 rating categories on a 1-5 scale:
  1. Costing
  2. Willingness to Buy
  3. Engagement Life
  4. Durability
  5. Age Appropriateness
  6. Ease of Use
  7. Aesthetics
  8. Easy to Store / Travel Friendliness

> **[SCREENSHOT: Data Export Page]**
> *Insert screenshot showing the Data & Reports page with export options*

### 3.7 Slack Messages

Admins can view messages from project Slack channels.

**To view Slack messages:**
1. Click **Slack Messages** in the left sidebar
2. Select a project from the dropdown
3. Messages from that project's Slack channel will appear
4. The page auto-refreshes every 30 seconds

> **[SCREENSHOT: Slack Messages Page]**
> *Insert screenshot showing the Slack messages feed for a project channel*

---

## 4. Manager Guide

### 4.1 Manager Overview

Managers can **create and manage their own projects** but cannot access projects created by other managers. They coordinate with designers and track project progress through the 9-stage workflow.

**Manager Permissions:**
- Create, edit, and view **their own projects only**
- Mark stages as complete or unmark
- Assign designers to stages
- Send manual reminders via Slack
- Manage designers (add/remove)
- Access Slack configuration
- Export their project data
- View reports and analytics
- View Slack messages from their project channels

**Manager Limitations:**
- Cannot approve pending user accounts (Admin-only)
- Cannot view projects created by other managers

### 4.2 Creating a New Project

**Step 1:** Click **Create Project** from the Dashboard or Projects page.

**Step 2:** Fill in the project details:

| Field | Description |
|-------|-------------|
| **Project Name** | A descriptive name for the product design project |
| **Description** | Brief overview of the product or project goals |
| **Priority** | Select priority level (High, Medium, Low) |
| **Phase Deadlines** | Set deadline for each of the 9 stages |
| **Assigned Designers** | Select one or more designers to work on this project |

**Step 3:** Click **Create Project** to finalize.

A new Slack channel will be automatically created for this project to facilitate designer communication.

> **[SCREENSHOT: Create Project Page]**
> *Insert screenshot showing the project creation form with all fields*

### 4.3 Managing Your Projects

**To view your projects:**
1. Click **Projects** in the left sidebar
2. You will see a table of all projects you created

**Project Table Columns:**
| Column | Description |
|--------|-------------|
| **Project Name** | Click to view project details |
| **Designer** | Assigned designer(s) |
| **Stage** | Current active stage |
| **Progress** | Percentage of completion |
| **Deadline** | Upcoming deadline date |
| **Status** | ON_TRACK, DELAYED, COMPLETED, or AT_RISK |
| **Actions** | Edit, view details, send reminders |

> **[SCREENSHOT: Manager Projects Page]**
> *Insert screenshot showing the manager's projects table*

### 4.4 Project Details & Workflow

**To view project details:**
1. Click on any project name in the Projects table
2. The Project Details page opens

**The Project Details page includes:**

**Workflow Tracker:**
- Visual representation of all 9 stages
- Connector lines between stages showing progression
- Color-coded stage cards indicating status

**Stage Cards:**
Each stage card shows:
- Stage name
- Deadline date
- Assigned designer(s)
- Status badge
- Progress percentage
- Action buttons (Mark Complete, Assign Designers)

**Available Actions:**
- **Mark Stage Complete** -- When a stage is finished
- **Unmark Stage** -- If a stage was marked incorrectly
- **Assign Designers** -- Change designer assignments for a stage
- **Send Reminder** -- Trigger a manual Slack reminder to designers

> **[SCREENSHOT: Project Details Page]**
> *Insert screenshot showing the project details page with workflow tracker and stage cards*

### 4.5 Stage Evaluation Reports

Managers can review and submit stage evaluation reports for each project phase.

**8 Rating Categories (1-5 scale):**

| Rating | Description |
|--------|-------------|
| **Costing** | Is the product cost-effective? |
| **Willingness to Buy** | Would customers be willing to purchase this? |
| **Engagement Life** | How long will the product keep users engaged? |
| **Durability** | How durable is the product? |
| **Age Appropriateness** | Is the product suitable for the target age group? |
| **Ease of Use** | How easy is it for users to interact with the product? |
| **Aesthetics** | How visually appealing is the design? |
| **Easy to Store / Travel Friendliness** | How portable and storage-friendly is the product? |

**To submit a report:**
1. Navigate to the project details page
2. Click **Submit Report** for the relevant stage
3. Fill in ratings for each category (1-5 scale)
4. Add any additional notes
5. Click **Submit**

Reports can also be submitted through the **Data & Reports** page with filtering options.

> **[SCREENSHOT: Stage Evaluation Report Modal]**
> *Insert screenshot showing the report submission form with all 8 rating categories*

### 4.6 Managing Designers

Managers can add and remove designers, just like Admins.

**To add a designer:**
1. Click **Designers** in the left sidebar
2. Click **Add Designer**
3. Enter the designer's name and email
4. Click **Add**

**To remove a designer:**
1. Navigate to the **Designers** page
2. Find the designer
3. Click the **Remove** button

> **[SCREENSHOT: Manager Designers Page]**
> *Insert screenshot showing the designers management page*

### 4.7 Slack Configuration

Managers can configure and manage Slack settings for their projects.

**To access Slack Settings:**
1. Click **Slack Settings** in the left sidebar
2. View or update:
   - Slack App Token
   - Bot User OAuth Token
   - Signing Secret
   - Webhook URL
3. Create new project channels or disconnect existing ones

> **[SCREENSHOT: Manager Slack Settings Page]**
> *Insert screenshot showing the Slack settings configuration*

### 4.8 Slack Messages

Managers can view messages from their project Slack channels.

**To view messages:**
1. Click **Slack Messages** in the left sidebar
2. Select a project from the dropdown
3. View the message feed (auto-refreshes every 30 seconds)

> **[SCREENSHOT: Manager Slack Messages Page]**
> *Insert screenshot showing the Slack messages view*

### 4.9 Data & Reports Export

Managers can export their project data and reports.

**To export:**
1. Click **Data & Reports** in the left sidebar
2. Choose what to export:
   - Designers
   - Projects
   - Stage Evaluation Reports
3. Select format: **CSV** or **Excel**
4. Click **Export**

**Report Filtering:**
- Filter by project, designer, stage, or date range
- Switch between **Table** and **Summary** views
- Summary view shows average ratings across reports

> **[SCREENSHOT: Manager Data Export Page]**
> *Insert screenshot showing the export options and report filtering*

---

## 5. Designer Guide

### 5.1 Designer Overview

Designers interact with the Smartivity platform **entirely through Slack**. There is no web dashboard for designers. This section explains how designers work with the system.

**Designer Capabilities:**
- Receive project assignments via Slack
- Complete project stages via Slack buttons
- Submit stage evaluation reports through Slack modals
- Report delays or blockers
- Update notes and progress
- View project information
- Receive automated reminders

**Designer Limitations:**
- Cannot access the web dashboard
- Cannot view projects, reports, or settings through the web interface
- Interact only through their assigned Slack channels

### 5.2 First-Time Login

When a Designer first logs in, they will see a **Designer Landing Page** with a welcome message and motivational quotes.

**What you will see:**
- A welcome screen with motivational quotes
- Information about how the platform works
- Explanation that project management happens through Slack

> **[SCREENSHOT: Designer Landing Page]**
> *Insert screenshot showing the designer welcome/landing page with motivational quote*

After the landing page, designers see a **Designer Restricted Page** that explains:
- They manage projects through Slack, not the web dashboard
- How to check their assigned projects in Slack
- What to expect from daily reminders and notifications

> **[SCREENSHOT: Designer Restricted Page]**
> *Insert screenshot showing the designer restricted/access explanation page*

### 5.3 Working Through Slack

All designer work happens within the **Smartivity Slack bot** in their project channels.

**How it works:**

1. **Project Assignment:** When a manager assigns you to a project, a Slack channel is created for that project. You will receive a message in that channel with project details.

2. **Interactive Buttons:** The Slack messages contain buttons you can click to:
   - Complete a stage
   - Submit a stage report
   - Report a delay
   - Update notes
   - View project information

3. **Modal Forms:** Clicking certain buttons opens Slack modal forms where you can:
   - Enter ratings for stage evaluations (8 categories on a 1-5 scale)
   - Provide delay explanations
   - Add progress notes
   - Ask project clarifications

> **[SCREENSHOT: Slack Project Channel]**
> *Insert screenshot showing a project Slack channel with Smartivity bot messages and interactive buttons*

### 5.4 Daily Check-Ins

The Smartivity Slack bot sends **automated daily check-in reminders** at **10:00 AM IST**.

**What to do:**
1. Check your project Slack channels for the daily reminder message
2. Click the appropriate button to update your status:
   - **Update Notes** -- Add your current progress
   - **Report Delay** -- If you are behind schedule
3. Fill in the modal form that appears
4. Submit your update

**Deadline Reminders:** When a project phase deadline arrives, you will also receive a specific deadline reminder.

> **[SCREENSHOT: Daily Check-in Reminder in Slack]**
> *Insert screenshot showing the daily check-in reminder message from the Smartivity bot*

### 5.5 Completing a Stage

When you finish work on a project stage, you can mark it complete through Slack.

**Steps:**
1. Open the project channel in Slack
2. Find the message for the current stage
3. Click the **"Complete Stage"** button
4. Confirm the completion in the modal that appears
5. The stage will be marked as complete in the system

> **[SCREENSHOT: Complete Stage Button in Slack]**
> *Insert screenshot showing the "Complete Stage" button and confirmation modal*

### 5.6 Submitting Stage Reports

After completing a stage, you are expected to submit a detailed evaluation report.

**Steps:**
1. In the project Slack channel, click the **"Submit Report"** button
2. A modal form will open with 8 rating categories
3. Rate each category on a **1-5 scale**:

| Rating | Scale Meaning |
|--------|---------------|
| 1 | Poor |
| 2 | Below Average |
| 3 | Average |
| 4 | Good |
| 5 | Excellent |

| Category | What to Evaluate |
|----------|-----------------|
| Costing | Is the product cost-effective for manufacturing? |
| Willingness to Buy | Would target customers purchase this? |
| Engagement Life | How long will it keep users engaged? |
| Durability | How well-built and long-lasting is it? |
| Age Appropriateness | Is it suitable for the target age group? |
| Ease of Use | How intuitive is it for the end user? |
| Aesthetics | How visually appealing is the design? |
| Easy to Store / Travel | How portable and storage-friendly is it? |

4. Add any additional notes in the text field
5. Click **Submit**

> **[SCREENSHOT: Stage Report Submission Modal in Slack]**
> *Insert screenshot showing the Slack modal form with all 8 rating categories*

### 5.7 Reporting Delays

If you encounter blockers or realize you cannot meet a deadline, report it immediately through Slack.

**Steps:**
1. In the project Slack channel, click the **"Report Delay"** button
2. A modal form will open
3. Select the reason for the delay:
   - Resource constraints
   - Technical challenges
   - Design revisions needed
   - Other (specify in notes)
4. Add detailed notes explaining the situation
5. Click **Submit**

Your manager will be notified and can take appropriate action.

> **[SCREENSHOT: Delay Report Modal in Slack]**
> *Insert screenshot showing the delay report submission form in Slack*

### 5.8 Updating Notes

You can update your progress notes at any time through Slack.

**Steps:**
1. In the project Slack channel, click the **"Update Notes"** button
2. A modal form will open
3. Type your progress update, including:
   - What you have completed
   - What you are currently working on
   - Any blockers or concerns
4. Click **Submit**

> **[SCREENSHOT: Update Notes Modal in Slack]**
> *Insert screenshot showing the notes update form in Slack*

### 5.9 Viewing Project Information

You can view details about your assigned projects at any time through Slack.

**Steps:**
1. In the project Slack channel, click the **"View Project"** button
2. A message will appear with:
   - Project name and description
   - Current stage
   - Assigned designers
   - Upcoming deadlines
   - Progress percentage

> **[SCREENSHOT: View Project Information in Slack]**
> *Insert screenshot showing the project information display in Slack*

---

## 6. The 9-Stage Workflow

### 6.1 Stage Overview

Smartivity uses a **9-stage linear workflow** for product design. Each stage must be completed in order before moving to the next.

| Stage | Name | Description |
|-------|------|-------------|
| 1 | **Lock Concept** | Initial product concept is finalized and approved |
| 2 | **Lock UX Features** | User experience features are defined and locked |
| 3 | **Lock MRP** | Minimum Viable Product / Manufacturing Requirements are specified |
| 4 | **Lock Graphics Theme** | Visual design and graphics theme are finalized |
| 5 | **Lock Production Feasibility** | Manufacturing feasibility is assessed and confirmed |
| 6 | **Lock Procurement** | Material sourcing and procurement plan is locked |
| 7 | **Lock IM** | Industrial Manufacturing process is finalized |
| 8 | **Lock CCP** | Critical Control Points are established and locked |
| 9 | **Final Handover** | Project is completed and handed over for production |

> **[SCREENSHOT: 9-Stage Workflow Visual]**
> *Insert screenshot showing the workflow tracker with all 9 stages connected*

### 6.2 Stage Progression

**How stages progress:**

1. A Manager assigns designers to a stage
2. Designers work on the stage and submit reports via Slack
3. When complete, the stage is marked as complete (via Slack button or web dashboard)
4. The next stage becomes active
5. This continues until Stage 9 (Final Handover) is reached

**Stage Status Indicators:**

| Status | Color | Meaning |
|--------|-------|---------|
| **ON_TRACK** | Green | Project is progressing as planned |
| **DELAYED** | Red | Project has missed a deadline |
| **COMPLETED** | Blue | All 9 stages are finished |

---

## 7. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **Cannot log in** | Verify your email and password. If you just registered, check if your account has been approved by an Admin. |
| **Account shows "Pending Approval"** | Contact your Admin to approve your account and assign a role. |
| **Cannot see projects** | If you are a Manager, you can only see projects you created. If you are a Designer, you interact through Slack, not the web dashboard. |
| **Slack reminders not arriving** | Ensure the Slack bot is properly configured in Slack Settings. Check that the bot has been added to your workspace and project channels. |
| **Cannot submit reports in Slack** | Make sure you are in the correct project channel and the stage is active. Try refreshing Slack. |
| **Dashboard shows no data** | Ensure you have at least one project assigned or created. If you are a Manager, verify you have created projects. |
| **Export not working** | Try a different browser. Ensure you have the necessary permissions (Admin or Manager). |

### Getting Help

If you encounter issues not covered here:
1. Contact your **Admin** or **Manager**
2. Check the **Slack Settings** page to verify integration is working
3. Reach out to the Smartivity support team

---

## 8. Support

For questions, issues, or feature requests:

- **Admin Contact:** Check with your organization's Smartivity Admin
- **Email:** [Contact your Smartivity administrator]
- **Slack:** Reach out in the #smartivity-support channel

---

*Last Updated: August 2026*
*Version: 1.0*
