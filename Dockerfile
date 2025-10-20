FROM node:18.20.8-alpine AS build
WORKDIR /app
COPY client_ui/package*.json ./
COPY client_ui/ ./
RUN npm install --legacy-peer-deps && \
    npm run build


FROM python:3.10-slim
COPY client_api ./client_api
COPY entrypoint.sh supervisor.conf client_ui/server.py ./
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        supervisor \
        gcc \
        make \
        build-essential \
        cargo \
        rustc \
        python3-dev \
        pkg-config \
        libffi-dev \
        libssl-dev && \
    pip install --only-binary=:all: bcrypt==3.1.6 cryptography==2.6.1 paramiko==2.7.2 psutil==7.0.0 pynacl==1.3.0 || true && \
    CRYPTOGRAPHY_DONT_BUILD_RUST=1 pip install --no-cache-dir -r /client_api/requirements.txt && \
    cd /client_api && pip install --no-cache-dir -e . && \
    apt-get purge -y gcc make python3-dev libffi-dev && \
    apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /root/.cargo /root/.rustup && \
    mv /supervisor.conf /etc/supervisor/conf.d/ && \
    mkdir -p /client_ui && mv /server.py /client_ui && \
    chmod +x /entrypoint.sh

COPY --from=build /app/dist ./client_ui/dist
EXPOSE 15000 16000
ENTRYPOINT ["/entrypoint.sh"]
