#!/bin/bash
# apt-get install -y git nodejs npm && git clone git@github.com:IoTDeviceManager/DeviceManagerClient.git
set -e
echo "Starting container..."
mkdir -p /root/.ssh && cp /etc/device.d/id_rsa_docker /root/.ssh/id_rsa
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisor.conf
