FROM node:24-bookworm-slim AS frontend-deps
WORKDIR /frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM frontend-deps AS frontend-test
COPY frontend/ ./
CMD ["sh", "-c", "npm run test:run && npm run lint && npm run typecheck"]

FROM frontend-test AS frontend-build
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS base
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
COPY backend/pyproject.toml backend/uv.lock ./

FROM base AS test
RUN uv sync --locked
COPY backend/app ./app
COPY backend/tests ./tests
COPY --from=frontend-build /frontend/out ./app/static
CMD ["uv", "run", "--locked", "pytest", "-q"]

# Exercise the Vercel hook with Node 24 and Python 3.14 in one Linux environment.
FROM base AS vercel-test
COPY --from=frontend-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend-deps /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
COPY --from=frontend-deps /root/.npm/ /root/.npm/
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /workspace/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked
COPY backend/ ./
COPY frontend/ ../frontend/
RUN npm_config_offline=true uv run --locked python build_frontend.py
CMD ["uv", "run", "--locked", "pytest", "-q"]

FROM base AS runtime
RUN uv sync --locked --no-dev \
    && useradd --create-home appuser \
    && mkdir /data \
    && chown appuser:appuser /data
COPY backend/app ./app
COPY --from=frontend-build /frontend/out ./app/static
ENV DATABASE_PATH=/data/kanban.db
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
