# The validation presenter and its server, for a machine that is not yours to look after: one small image, no
# dependencies beyond Python's standard library. The sessions are written to /data, a volume, never into the image.
#
#     docker compose up -d --build        (see docs/deploying.md)

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATA_DIR=/data

# not root; the uid is fixed so a folder on the host can be given to it (chown 10001:10001 data)
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir /data && chown 10001:10001 /data

WORKDIR /app
COPY server.py index.html stimulus.html LICENSE.md ./
COPY src ./src
COPY assets ./assets
COPY vendor ./vendor
COPY docs ./docs

USER 10001
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('PORT', '8000'), timeout=3)"

CMD ["python", "server.py"]
