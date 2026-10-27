FROM python:3.12-slim
WORKDIR /app
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements-production.txt && useradd --create-home lookahan
COPY --chown=lookahan:lookahan app ./app
COPY --chown=lookahan:lookahan scripts ./scripts
COPY --chown=lookahan:lookahan wsgi.py ./
RUN mkdir -p /app/instance/logs /backups && chown -R lookahan:lookahan /app/instance /backups
USER lookahan
EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "90", "--access-logfile", "-", "--error-logfile", "-", "wsgi:app"]
