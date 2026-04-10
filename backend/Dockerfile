FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py .

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import httpx; httpx.get('http://localhost:8080/health').raise_for_status()"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
