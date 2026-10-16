
# One Render Docker web service hosts BOTH the Node API and the Python/FFmpeg renderer.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PATH="/opt/quote-venv/bin:$PATH"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ffmpeg fontconfig fonts-noto-core fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt /app/worker/requirements.txt

RUN python3 -m venv /opt/quote-venv \
    && /opt/quote-venv/bin/pip install --no-cache-dir -r /app/worker/requirements.txt

COPY backend/ /app/backend/
COPY worker/ /app/worker/

# Fail build early if Python code is invalid for the runtime version.
RUN python -m py_compile /app/worker/main.py

COPY scripts/start-render.sh /app/scripts/start-render.sh

RUN chmod +x /app/scripts/start-render.sh \
    && mkdir -p /app/output \
    && useradd --create-home --uid 10001 studio \
    && chown -R studio:studio /app/output /app

USER studio

EXPOSE 10000

CMD ["/bin/sh", "/app/scripts/start-render.sh"]
