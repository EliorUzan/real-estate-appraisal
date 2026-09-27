FROM python:3.12-slim
WORKDIR /app
# Pin the source revision whose tool arguments and response fields were verified.
ARG NADLAN_REVISION=b87cb268d5f0265dee327b0a237da8ccd5062b8f
RUN pip install --no-cache-dir "https://github.com/nitzpo/nadlan-mcp/archive/${NADLAN_REVISION}.zip" \
    "fastmcp==2.14.7" "mcp==1.30.0" "uvicorn==0.54.0" "starlette==1.7.0"
COPY server.py /app/server.py
RUN useradd --create-home appuser
USER appuser
ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "server.py"]
