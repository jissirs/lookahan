"""จุดเริ่มรันแอป — `flask --app wsgi run` หรือ `gunicorn wsgi:app`"""
from app import create_app

app = create_app()
