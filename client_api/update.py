# update.py
import os, sys, time, tarfile
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form, BackgroundTasks
from helpers import (
    CURRENT_DIR, STAGE_DIR, CURRENT_OVERRIDE_SCRIPT_PATH, get_version,
    SSHClient, clear_stage_dir, clear_current_dir, get_device_token,
    get_stage_version, clean_ansi_and_whitespace, USER_ROLE
)
from users import get_current_user

SUCCESS = 0
router = APIRouter(tags=["Update"])

FILE_SIZE_TOTALS = {}
DISK_WRITE_PROGRESS = {}
BUNDLE_VERSIONS = {}
DECRYPT_START_TIME = {}
UPDATE_PROGRESS = {}

def delayed_cleanup(filename: str, delay: int = 3):
    time.sleep(delay)
    DISK_WRITE_PROGRESS.pop(filename, None)
    BUNDLE_VERSIONS.pop(filename, None)
    DECRYPT_START_TIME.pop(filename, None)
    FILE_SIZE_TOTALS.pop(filename, None)
    return None

@router.get("/version", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_software_version():
    return get_version()

@router.get("/version/staged", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_software_version_stage():
    return get_stage_version()

@router.post("/upload", dependencies=[Depends(get_current_user(USER_ROLE))])
def upload(
    file: UploadFile = File(...),
    total_size: int = Form(...),
):
    if file.filename != "bundle.tar.gz.enc":
        raise HTTPException(status_code=400, detail='File must have name "bundle.tar.gz.enc"')

    clear_stage_dir()
    target_path = STAGE_DIR / file.filename
    decrypt_path = STAGE_DIR / "bundle.tar.gz"
    
    FILE_SIZE_TOTALS[file.filename] = total_size
    DISK_WRITE_PROGRESS[file.filename] = 0
    BUNDLE_VERSIONS[file.filename] = None
    DECRYPT_START_TIME[file.filename] = None

    # Write file and update progress
    total_bytes = 0
    chunk_size = 1024 * 1024  # 1MB
    with open(target_path, "wb") as f:
        while chunk := file.file.read(chunk_size):
            f.write(chunk)
            total_bytes += len(chunk)
            DISK_WRITE_PROGRESS[file.filename] = total_bytes

    # Start decryption timer
    DECRYPT_START_TIME[file.filename] = time.time()

    with SSHClient() as sshContext:
        stdout, stderr, code = sshContext.run_command(
            f'openssl enc -aes-256-cbc -d -salt -pbkdf2 -in "{target_path}" '
            f'-out "{decrypt_path}" -pass pass:"{get_device_token()}"'
        )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"File decryption failed: {stderr.strip()}")
    os.remove(target_path)

    # Validate archive contents
    required_files = {"docker-compose.yml", ".version", ".env"}
    required_dirs = {"cmount", "images"}
    found_files = set()
    found_dirs = set()
    version_string = None
    contains_override = False

    try:
        with tarfile.open(decrypt_path, "r:gz") as tar:
            for member in tar.getmembers():
                name = member.name.split("/")[-1]

                if name in required_files:
                    found_files.add(name)
                if name in required_dirs:
                    found_dirs.add(name)
                if name == "override.sh" and member.isfile():
                    contains_override = True
                if name == ".version" and member.isfile():
                    version_file = tar.extractfile(member)
                    if version_file:
                        version_string = version_file.read().decode("utf-8", errors="ignore").strip()
                        BUNDLE_VERSIONS[file.filename] = version_string
                        # Write version_string to a .version file inside STAGE_DIR
                        version_path = STAGE_DIR / ".version"
                        with open(version_path, "w", encoding="utf-8") as vf:
                            vf.write(version_string)

        missing_files = required_files - found_files
        missing_dirs = required_dirs - found_dirs
        if missing_files or missing_dirs:
            detail = ""
            if missing_files:
                detail += f"Missing required file(s): {', '.join(missing_files)}. "
            if missing_dirs:
                detail += f"Missing required directory(s): {', '.join(missing_dirs)}."
            clear_stage_dir()
            raise HTTPException(status_code=400, detail=detail.strip())

    except tarfile.TarError as e:
        clear_stage_dir()
        raise HTTPException(status_code=500, detail=f"Failed to read archive: {e}")

    status = "Upload successful!"
    if contains_override:
        status += " WARNING: Bundle contains an override script!"

    return {
        "status": status,
        "filename": file.filename,
        "version": version_string,
    }

@router.get("/upload/progress", dependencies=[Depends(get_current_user(USER_ROLE))])
def upload_progress(filename: str, background_tasks: BackgroundTasks):
    """
    Return upload and decryption progress + estimate for the given filename.
    Assumes decryption speed is 30 MB/s.
    """
    total_size = FILE_SIZE_TOTALS.get(filename)
    bytes_written = DISK_WRITE_PROGRESS.get(filename, 0)
    upload_version = BUNDLE_VERSIONS.get(filename, None)
    decrypt_start = DECRYPT_START_TIME.get(filename)

    if not total_size:
        raise HTTPException(status_code=404, detail="No upload info found for this filename")

    # Upload progress percentage (0-100)
    disk_write_percent = int((bytes_written / total_size) * 100)

    # Decryption time estimate in minutes
    decryption_speed_bps = 20 * 1024 * 1024  # 20 MB/s in bytes
    estimated_decrypt_secs = total_size / decryption_speed_bps

    decrypt_elapsed_secs = 0
    decrypt_remaining_secs = estimated_decrypt_secs

    if decrypt_start:
        decrypt_elapsed_secs = time.time() - decrypt_start
        decrypt_remaining_secs = max(0, estimated_decrypt_secs - decrypt_elapsed_secs)

    if upload_version is not None:
        background_tasks.add_task(delayed_cleanup, filename, 3)

    return {
        "disk_write_percent": disk_write_percent,
        "upload_version": upload_version,
        "decryption_elapsed_secs": round(decrypt_elapsed_secs, 1),
        "decryption_remaining_secs": round(decrypt_remaining_secs, 1),
        "estimated_decrypt_minutes": round(estimated_decrypt_secs / 60, 2),
    }

@router.post("/update", dependencies=[Depends(get_current_user(USER_ROLE))])
def update():
    tarballs = sorted([
        f for f in STAGE_DIR.glob("*.tar.gz")
        if "backup" not in f.name
    ])

    if not tarballs:
        raise HTTPException(status_code=404, detail="No update bundle found.")

    clear_current_dir()
    bundle = tarballs[0]
    bundle_size_bytes = bundle.stat().st_size

    UPDATE_PROGRESS.clear()
    UPDATE_PROGRESS.update({
        "status": "extracting",
        "percent": 0,
        "log": "",
        "time_start": time.time(),
        "file_size": bundle_size_bytes
    })

    # Extract update
    try:
        with tarfile.open(bundle) as tar:
            tar.extractall(path=CURRENT_DIR)
    except Exception as e:
        UPDATE_PROGRESS.update({
            "status": "error",
            "percent": 0,
            "log": f"Extraction failed: {e}",
        })
        raise HTTPException(status_code=500, detail="Failed to extract update bundle")
    
    UPDATE_PROGRESS.update({
        "status": "running",
        "percent": 0,
        "log": "",
    })

    script = f"""
    docker ps -a --format '{{{{.ID}}}} {{{{.Names}}}}' \
        | grep -v -w 'device_manager' \
        | awk '{{print $1}}' \
        | xargs -r docker rm -f && \
    cd {CURRENT_DIR} && \
    for img in images/*.tar.gz; do docker load -i "$img"; done && \
    docker-compose up -d && \
    docker system prune -af
    """

    if CURRENT_OVERRIDE_SCRIPT_PATH.exists():
        os.chmod(CURRENT_OVERRIDE_SCRIPT_PATH, 0o777)

        # Override warning wrapper
        script = f"""
        echo "⚠️  WARNING: Override script detected — you are now in no-man's land." && \\
        sleep 3 && \\
        cd {CURRENT_DIR} && \\
        ./override.sh
        """

        UPDATE_PROGRESS.update({
            "log": "Update running in override mode.",
        })


    data = b""
    try:
        with SSHClient() as ssh:
            transport = ssh.client.get_transport()
            channel = transport.open_session()
            channel.set_combine_stderr(True)
            script = ssh._wrap_command(script)
            channel.exec_command(script)

            while True:
                if channel.recv_ready():
                    chunk = channel.recv(1024)
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.flush()
                    data += chunk
                    decoded = chunk.decode("utf-8", errors="replace")
                    cleaned = clean_ansi_and_whitespace(decoded)
                    UPDATE_PROGRESS["log"] += cleaned

                    # Optional: naive progress estimation
                    UPDATE_PROGRESS["percent"] = min(100, UPDATE_PROGRESS["percent"] + 1)

                if channel.exit_status_ready():
                    break

            exit_code = channel.recv_exit_status()

    except Exception as e:
        UPDATE_PROGRESS.update({
            "status": "error",
            "percent": UPDATE_PROGRESS.get("percent", 0),
            "log": UPDATE_PROGRESS["log"] + f"\nAccess error: {e}",
        })
        clear_stage_dir()
        clear_current_dir()
        raise HTTPException(status_code=500, detail="Access or command execution failed")

    if exit_code != 0:
        UPDATE_PROGRESS.update({
            "status": "error",
            "percent": 100,
            "log": UPDATE_PROGRESS["log"] + f"\nScript failed with exit code {exit_code}",
        })
        clear_stage_dir()
        clear_current_dir()
        raise HTTPException(status_code=500, detail="Script failed")

    UPDATE_PROGRESS.update({
        "status": "complete",
        "percent": 100,
    })

    clear_stage_dir()
    return {"detail": "Update complete"}

@router.get("/update-progress", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_update_progress():
    if UPDATE_PROGRESS.get("status", "unknown") == "extracting":
        extraction_speed_mbps = 20
        extraction_speed_bps = extraction_speed_mbps * 1024 * 1024
        elapsed = time.time() - UPDATE_PROGRESS["time_start"]
        file_size_bytes = UPDATE_PROGRESS["file_size"]
        total_expected_time = file_size_bytes / extraction_speed_bps
        approx_percent_complete = (elapsed / total_expected_time) * 100
        if approx_percent_complete > 100:
            approx_percent_complete = "Unknown"
        return {
            "status": "extracting",
            "percent": round(approx_percent_complete),
            "log": ""
        }
        
    return UPDATE_PROGRESS
