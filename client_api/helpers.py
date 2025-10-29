import os
import re
import sys
import shutil
import logging
import paramiko
from pathlib import Path

ADMIN_ROLE = "admin"
USER_ROLE = "common"
KEY = paramiko.Ed25519Key.from_private_key_file("/root/.ssh/id_rsa")
ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
DEVICE_DIR = Path("/etc/device.d")
DEVICE_TOKEN_FILE = Path(f"{DEVICE_DIR}/iot_token.txt")
CURRENT_DIR = Path(f"{DEVICE_DIR}/current") # Contains all code and tools associated with the current software
CURRENT_STATE_FILE = Path(f"{CURRENT_DIR}/.state")
CURRENT_VERSION_FILE = Path(f"{CURRENT_DIR}/.version")
CURRENT_OVERRIDE_SCRIPT_PATH = Path(f"{CURRENT_DIR}/override.sh")
BACKUP_DIR = Path(f"{DEVICE_DIR}/backup") # Used to preserve the current system state in case an update fails
BACKUP_STATE_FILE = Path(f"{BACKUP_DIR}/.state")
BACKUP_VERSION_FILE = Path(f"{BACKUP_DIR}/.version")
BACKUP_OVERRIDE_SCRIPT_PATH = Path(f"{BACKUP_DIR}/override.sh")
STAGE_DIR = Path(f"{DEVICE_DIR}/stage") # Used to upload/store update bundles
STAGE_VERSION_FILE = Path(f"{STAGE_DIR}/.version")
os.makedirs(CURRENT_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(STAGE_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

def clean_ansi_and_whitespace(s: str) -> str:
    clean_str = ANSI_ESCAPE.sub("", s)
    return "\n".join(line.rstrip() for line in clean_str.splitlines())

def clear_current_dir():
    shutil.rmtree(CURRENT_DIR)
    os.makedirs(CURRENT_DIR)

def clear_backup_dir():
    shutil.rmtree(BACKUP_DIR)
    os.makedirs(BACKUP_DIR)

def clear_stage_dir():
    shutil.rmtree(STAGE_DIR)
    os.makedirs(STAGE_DIR)

def create_backup():
    clear_backup_dir()
    for item in os.listdir(CURRENT_DIR):
        source = os.path.join(CURRENT_DIR, item)
        destination = os.path.join(BACKUP_DIR, item)
        if os.path.isdir(source):
            shutil.copytree(source, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(source, destination)

def get_device_token():
    if DEVICE_TOKEN_FILE.exists():
        with open(DEVICE_TOKEN_FILE, "r") as f:
            return f.readline().strip()
    return "Unknown"

def get_version():
    if CURRENT_VERSION_FILE.exists():
        with open(CURRENT_VERSION_FILE, "r") as f:
            return f.readline().strip()
    return "Unknown"

def get_stage_version():
    if STAGE_VERSION_FILE.exists():
        with open(STAGE_VERSION_FILE, "r") as f:
            return f.readline().strip()
    return "Unknown"

class SSHClient:
    def __init__(self):
        """
        Initialize the SSH client.
        """
        self.hostname = "localhost"
        self.username = "root"
        self.port = 22
        self.timeout = 10
        self.client = None
        self.channel = None  # for interactive shell

    def connect(self):
        """Establish SSH connection."""
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(
            hostname=self.hostname,
            port=self.port,
            username=self.username,
            pkey=KEY,
            timeout=self.timeout,
        )

    def open_sftp(self):
        if not self.client:
            raise RuntimeError("SSH client not connected. Call connect() first.")
        return self.client.open_sftp()

    def run_command(self, command):
        """
        Execute a command over SSH and return stdout, stderr, exit status.
        """
        if not self.client:
            raise RuntimeError("SSH client not connected. Call connect() first.")

        stdin, stdout, stderr = self.client.exec_command(command)
        exit_status = stdout.channel.recv_exit_status()
        return stdout.read().decode(), stderr.read().decode(), exit_status

    def start_interactive_shell(self, term="xterm"):
        """
        Start an interactive shell session (for WebSocket streaming).
        """
        if not self.client:
            raise RuntimeError("SSH client not connected. Call connect() first.")
        self.channel = self.client.invoke_shell(term=term)
        self.channel.settimeout(0.0)  # Non-blocking

    def interactive_recv(self, bufsize=1024):
        """
        Receive data from the interactive shell, if available.
        Returns decoded string or None.
        """
        if self.channel and self.channel.recv_ready():
            return self.channel.recv(bufsize).decode(errors="ignore")
        return None

    def interactive_send(self, data):
        """
        Send data to the interactive shell.
        """
        if self.channel:
            self.channel.send(data)

    def close(self):
        """Close SSH connection."""
        if self.channel:
            self.channel.close()
            self.channel = None
        if self.client:
            self.client.close()
            self.client = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, uselessOne, uselessTwo, uselessThree):
        self.close()
        