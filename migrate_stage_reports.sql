-- Create stage_reports table for structured stage evaluation reports
CREATE TABLE IF NOT EXISTS stage_reports (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    stage_index INTEGER NOT NULL,
    stage_name VARCHAR(255) NOT NULL,
    submitted_by_user_id VARCHAR(255) DEFAULT '',
    submitted_by_name VARCHAR(255) DEFAULT '',
    submitted_by_role VARCHAR(50) DEFAULT '',
    slack_user_id VARCHAR(255) DEFAULT '',
    costing INTEGER,
    willingness_to_buy INTEGER,
    engagement_life INTEGER,
    durability INTEGER,
    age_appropriateness INTEGER,
    ease_of_use INTEGER,
    aesthetics INTEGER,
    easy_to_store INTEGER,
    notes TEXT DEFAULT '',
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_stage_reports_project_id ON stage_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_stage_reports_stage_index ON stage_reports(stage_index);
CREATE INDEX IF NOT EXISTS idx_stage_reports_submitted_by ON stage_reports(submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_stage_reports_submitted_at ON stage_reports(submitted_at);
