FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY agent_replay/ agent_replay/
COPY web/ web/

RUN pip install --no-cache-dir .

EXPOSE 8420

CMD ["python", "-m", "agent_replay", "--host", "0.0.0.0", "--port", "8420", "--no-browser", "--public"]
