# Device Manager Development & Deployment Guide

This guide covers the complete workflow for developing, building, and deploying the Device Manager application using Docker and docker-slim optimization.

---

## 🔧 Development Workflow

### Prerequisites
- Docker installed and running
- Access to the repository
- Required SSH keys in `/etc/device.d/`

### Setup Development Environment

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd /root/DeviceManagerClient
   ```

2. **Build the base Docker image**
   ```bash
   docker build -t devicemanager .
   ```

3. **Start development container**
   ```bash
   docker run -it --rm --name=device_manager --network=host \
     -v /etc/os-release:/etc/os-release \
     -v /etc/hosts:/etc/hosts \
     -v /etc/device.d:/etc/device.d \
     -v /root/DeviceManagerClient:/root/DeviceManagerClient \
     --entrypoint=/bin/bash \
     devicemanager
   ```

4. **Configure SSH access inside container**
   ```bash
   mkdir -p /root/.ssh && cp /etc/device.d/id_rsa_docker /root/.ssh/id_rsa
   ```

5. **Install development tools**
   ```bash
   # Use correct commands for your distro
   apt-get update && apt-get install -y git curl tmux && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt install -y nodejs
   ```

### Development Process

6. **Edit code locally**
   - Modify files in `/root/DeviceManagerClient`
   - Changes are automatically reflected in the container via volume mount

7. **In one tmux window start the API**
   ```bash
   cd /root/DeviceManagerClient/client_api && uvicorn main:app --host 0.0.0.0 --port 15000
   ```

8. **In another tmux window start the UI**
   ```bash
   cd /root/DeviceManagerClient/client_ui && npm install && npm run dev -- --host 0.0.0.0 --port 16000
   ```

9. **Access the application**
   - **URL:** `http://<host-address>:16000`
   - **Credentials:** `admin / admin`

> **💡 Tip:** The development container uses volume mounts for live code reloading. No need to rebuild the image for code changes.

---

## 📦 Production Build Process

### Build Optimized Container

1. **Prepare the environment**
   ```bash
   cd /root/DeviceManagerClient
   ```

2. **Build base image** *(if not already built)*
   ```bash
   docker build -t devicemanager .
   ```

3. **Install build slim**
   ```bash
   curl -sL https://raw.githubusercontent.com/slimtoolkit/slim/master/scripts/install-slim.sh | sudo -E bash -
   ```

4. **Optimize with docker-slim**
   ```bash
   docker-slim build \
    --mount /etc/device.d:/etc/device.d \
    --network host \
    --preserve-path /client_ui \
    --preserve-path /client_api \
    --expose 15000 \
    --http-probe \
    --http-probe-ports "15000" \
    --http-probe-cmd "/api/base/heartbeat" \
    --http-probe-retry-count 10 \
    --http-probe-retry-wait 5 \
    devicemanager
   ```

   > **⚠️ Note:** This process significantly reduces image size while preserving essential Python libraries.

### Deploy to Registry

5. **Authenticate with container registry**
   ```bash
   docker login <your-registry>
   ```

6. **Tag the optimized image**
   ```bash
   # Determine architecture automatically
   ARCH=$(docker version --format '{{.Server.Arch}}')
   docker tag devicemanager.slim collabro/iotdevicemanager:1.0.0-${ARCH}
   ```

   **Manual architecture specification:**
   ```bash
   # For ARM64
   docker tag devicemanager.slim collabro/iotdevicemanager:1.0.0-arm64
   
   # For AMD64
   docker tag devicemanager.slim collabro/iotdevicemanager:1.0.0-amd64
   ```

7. **Push to registry**
   ```bash
   # Using automatic architecture detection
   docker push collabro/iotdevicemanager:1.0.0-${ARCH}
   
   # Or manually specify architecture
   docker push collabro/iotdevicemanager:1.0.0-arm64  # or amd64
   ```

---

## 🚀 Local Deployment

### Run Production Container

Deploy the optimized container locally for testing:

```bash
docker run -d --name=device_manager --network=host \
  -v /etc/os-release:/etc/os-release \
  -v /etc/hosts:/etc/hosts \
  -v /etc/device.d:/etc/device.d \
  devicemanager.slim
```

### Verification

- **Web Interface:** `http://<host-address>:16000`
- **API Documentation:** `http://<host-address>:15000/docs`
- **Health Check:** `http://<host-address>:15000/health`

---

## 📋 Command Reference

### Common Docker Commands

| Command | Purpose |
|---------|---------|
| `docker ps -a` | List all containers |
| `docker logs device_manager` | View container logs |
| `docker exec -it device_manager bash` | Access container shell |
| `docker stop device_manager && docker rm device_manager` | Clean up container |

### Architecture Detection

```bash
# Get current architecture
ARCH=$(docker version --format '{{.Server.Arch}}')
echo "Current architecture: $ARCH"
```

### Troubleshooting

- **Container won't start:** Check logs with `docker logs device_manager`
- **Port conflicts:** Ensure ports 15000 and 16000 are available
- **Volume mount issues:** Verify `/etc/device.d` exists and contains required files
- **Missing Python libraries:** Add additional `--preserve-path` flags to docker-slim command

---

## 🏗️ Architecture Overview

The Device Manager consists of:

- **Frontend:** React application served on port 16000
- **Backend:** FastAPI application on port 15000  
- **Supervisor:** Process manager coordinating both services
- **Docker-slim:** Optimization tool reducing image size by ~60%

> **💡 Best Practice:** Always test the optimized image locally before pushing to production registry.
