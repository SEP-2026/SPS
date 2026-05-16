import os
from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# Read DATABASE_URL from environment so local dev (localhost) and Docker (service name `db`) both work.
# Example values:
# - Docker compose: mysql+pymysql://admin:123456@db:3306/parking_db
# - Local MySQL: mysql+pymysql://admin:123456@localhost:3306/parking_db
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://admin:123456@db:3306/parking_db")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

if engine.url.get_backend_name().startswith("mysql"):
    @event.listens_for(engine, "connect")
    def set_mysql_timezone(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET time_zone = '+07:00'")
        finally:
            cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
