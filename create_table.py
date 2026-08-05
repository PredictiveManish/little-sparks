from sqlalchemy import create_engine, text

url = "postgresql://smartivity_db_user:K0pTXF9mSShyjvwTwRBPFWIDDj7iQ29P@dpg-d9hi1f3eo5us73e89npg-a.oregon-postgres.render.com/smartivity_db"
engine = create_engine(url)

with engine.connect() as conn:
    # Create the table manually (one-time setup)
    conn.execute(text("""
        CREATE TABLE slack_completion_tracker (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            stage_index INTEGER NOT NULL,
            designer_slack_user_id VARCHAR(255) DEFAULT '',
            designer_slack_user_name VARCHAR(255) DEFAULT '',
            designer_update TEXT,
            manager_slack_user_id VARCHAR(255) DEFAULT '',
            manager_slack_user_name VARCHAR(255) DEFAULT '',
            status VARCHAR(50) DEFAULT 'PENDING',
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            confirmed_at TIMESTAMP WITHOUT TIME ZONE
        );
    """))
    conn.commit()
    print("Table created successfully!")

    # Verify it exists
    result = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'slack_completion_tracker')"))
    print("Table exists:", result.scalar())
