"""Seed script to create an admin user for Designer Manager.

Usage from project root:
    python -m server.seed_admin

This connects to the database, creates a user with role=ADMIN,
and prints the email and password to the console.
"""

import os
import sys
import argon2
from dotenv import load_dotenv

# Add server directory to path so relative imports work
sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from .database import SessionLocal, engine, Base, init_db
from .models import User

ADMIN_EMAIL = "manish.tiwari.09@zohomail.in"
ADMIN_PASSWORD = "Manish@smartivity123"
ADMIN_NAME = "Manish Tiwari"


def seed_admin():
    # Create tables if they don't exist
    init_db()

    # Check if admin already exists
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if existing:
            print(
                f"User with email {ADMIN_EMAIL} already exists (id={existing.id}, role={existing.role})"
            )
            existing.role = "ADMIN"
            existing.password_hash = argon2.PasswordHasher().hash(ADMIN_PASSWORD)
            existing.name = ADMIN_NAME
            db.commit()
            print(f"Updated user {ADMIN_EMAIL} to ADMIN role.")
            print(f"\nLogin credentials:")
            print(f"  Email:    {ADMIN_EMAIL}")
            print(f"  Password: {ADMIN_PASSWORD}")
            return

        argon2_hasher = argon2.PasswordHasher()
        password_hash = argon2_hasher.hash(ADMIN_PASSWORD)

        user = User(
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            password_hash=password_hash,
            role="ADMIN",
            specialty="Product Manager",
            initials="MT",
            color="bg-purple-500",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        print(f"\nAdmin user created successfully!")
        print(f"  ID:       {user.id}")
        print(f"  Name:     {ADMIN_NAME}")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Role:     ADMIN")
        print(f"\nLogin credentials:")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_admin()
