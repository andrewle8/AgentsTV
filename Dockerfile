FROM python:3.12-slim

RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

COPY pyproject.toml README.md ./
COPY agentstv/ agentstv/
COPY web/ web/

RUN pip install --no-cache-dir .

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8420

CMD ["python", "-m", "agentstv", "--host", "0.0.0.0", "--port", "8420", "--no-browser", "--public"]
