FROM node:18-bullseye AS build
WORKDIR /app
COPY client_ui/package*.json ./
RUN npm install --legacy-peer-deps
COPY client_ui/ ./
RUN npm run build

FROM ubuntu:22.04
COPY client_api ./client_api
COPY entrypoint.sh supervisor.conf client_ui/server.py ./
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3-pip \
        supervisor && \
    pip install --no-cache-dir -r /client_api/requirements.txt && \
    cd /client_api && pip install --no-cache-dir -e . && \
    mv /supervisor.conf /etc/supervisor/conf.d && \
    mkdir -p /client_ui && mv /server.py /client_ui && \
    chmod a+x /entrypoint.sh

COPY --from=build /app/dist ./client_ui/dist
EXPOSE 15000 16000
ENTRYPOINT ["/entrypoint.sh"]
