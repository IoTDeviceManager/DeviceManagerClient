FROM --platform=linux/amd64 node:18.20.8-alpine AS build
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
        curl \
        supervisor && \
    curl -L https://github.com/IoTDeviceManager/DeviceManagerInstall/raw/refs/heads/main/wheels.tar.gz -o /wheels.tar.gz && \
    mkdir -p /wheels && tar -xzf /wheels.tar.gz -C / && \
    rm /wheels.tar.gz && \
    ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
        armhf) WHEEL_ARCH="armv7" ;; \
        armel) WHEEL_ARCH="armv6" ;; \
        arm64) WHEEL_ARCH="arm64" ;; \
        i386) WHEEL_ARCH="i386" ;; \
        amd64) WHEEL_ARCH="amd64" ;; \
        *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac && \
    pip install /wheels/wheels_$WHEEL_ARCH/* && \
    cd /client_api && pip install --no-cache-dir -e . && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    mv /supervisor.conf /etc/supervisor/conf.d/ && \
    mkdir -p /client_ui && mv /server.py /client_ui && \
    chmod +x /entrypoint.sh

COPY --from=build /app/dist ./client_ui/dist
EXPOSE 15000 16000
ENTRYPOINT ["/entrypoint.sh"]