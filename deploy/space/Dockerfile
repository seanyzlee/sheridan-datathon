# Toonie on Hugging Face Spaces (Docker SDK). Built from the folder tools/make_space.py assembles.

# 1. Build the React front end
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. Python API, serving the built front end
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The C++ simulation core is optional: if it does not build, simulate.py uses the NumPy fallback
COPY hpc/ hpc/
RUN pip install --no-cache-dir ./hpc || echo "C++ core did not build; the NumPy fallback will be used"

COPY --chown=user . .
COPY --from=web --chown=user /web/dist web/dist

USER user
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2
EXPOSE 7860
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "7860"]
