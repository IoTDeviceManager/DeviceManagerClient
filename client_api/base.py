# network.py
import json
import time
import distro
import platform
import asyncio
import psutil
from datetime import datetime, timedelta
from fastapi import APIRouter, Form, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import StreamingResponse
from helpers import CURRENT_DIR, USER_ROLE, CURRENT_STATE_FILE, SSHClient, get_version, clean_ansi_and_whitespace, logger, get_base_os
from users import get_current_user, get_current_user_manual

router = APIRouter(tags=["Base"])

def get_state():
    if CURRENT_STATE_FILE.exists():
        with open(CURRENT_STATE_FILE, "r") as f:
            return f.readline().strip()
    return "Unknown"

def set_state(state: str):
    CURRENT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CURRENT_STATE_FILE, "w") as f:
        f.write(state.strip() + "\n")

def get_system_health():
    """
    Get comprehensive system health metrics in human readable format only
    
    Returns:
        dict: Human readable system health metrics
    """

    def format_bytes(bytes_value):
        """Convert bytes to human readable format"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if bytes_value < 1024.0:
                return f"{bytes_value:.1f} {unit}"
            bytes_value /= 1024.0
        return f"{bytes_value:.1f} PB"

    def format_uptime(seconds):
        """Convert seconds to human readable uptime"""
        delta = timedelta(seconds=int(seconds))
        days = delta.days
        hours, remainder = divmod(delta.seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        elif hours > 0:
            return f"{hours}h {minutes}m"
        else:
            return f"{minutes}m"
        
    def get_load_status(load_1m, cpu_count):
        """Interpret load average status"""
        if load_1m < cpu_count * 0.7:
            return "OK"
        elif load_1m < cpu_count:
            return "Normal"
        elif load_1m < cpu_count * 1.5:
            return "High" 
        else:
            return "Critical"

    def get_docker_containers():
        """Get Docker container information via SSH"""
        try:
            with SSHClient() as sshContext:
                # Check if Docker is available and get container info
                command = "/usr/local/bin/docker ps --format json"
                if get_base_os() == "windows":
                    command = "docker ps --format json"
                stdout, stderr, code = sshContext.run_command(command)
                
                if code != 0:
                    # Handle specific Docker error cases
                    error_msg = stderr.strip() if stderr.strip() else "Unknown Docker error"
                    
                    if "permission denied" in error_msg.lower():
                        return {
                            'total_running': 0,
                            'containers': [],
                            'error': 'Docker permission denied - user may need to be in docker group'
                        }
                    elif "cannot connect to the docker daemon" in error_msg.lower():
                        return {
                            'total_running': 0,
                            'containers': [],
                            'error': 'Docker daemon is not running'
                        }
                    elif "command not found" in error_msg.lower():
                        return None  # Docker not installed - don't show Docker section at all
                    else:
                        return {
                            'total_running': 0,
                            'containers': [],
                            'error': f'Docker error: {error_msg}'
                        }
            
            # Parse container data
            containers = []
            valid_lines = [line.strip() for line in stdout.strip().split('\n') if line.strip()]
            
            for line in valid_lines:
                try:
                    container = json.loads(line)
                    if "device_manager" in container.get('Names', 'Unknown'):
                        continue
                    else:
                        containers.append({
                            'name': container.get('Names', 'Unknown'),
                            'image': container.get('Image', 'Unknown'),
                            'status': container.get('Status', 'Unknown'),
                            'state': container.get('State', 'Unknown')
                        })
                except json.JSONDecodeError as e:
                    # Log the problematic line but continue processing others
                    logger.warning(f"Warning: Failed to parse Docker container JSON: {line[:100]}... Error: {e}")
                    continue
            
            return {
                'total_running': len(containers),
                'containers': containers[:10],  # Limit to 10 most recent
                'status': 'success'
            }
            
        except Exception as e:
            # Catch any unexpected errors (SSH failures, etc.)
            logger.error(f"Unexpected error getting Docker containers: {e}")
            return {
                'total_running': 0,
                'containers': [],
                'error': f'Failed to connect or retrieve Docker info: {str(e)}'
            }

    def get_disk_io():
        """Get disk I/O metrics"""
        try:
            disk_io = psutil.disk_io_counters()
            if disk_io:
                return {
                    'read_total': format_bytes(disk_io.read_bytes),
                    'write_total': format_bytes(disk_io.write_bytes),
                    'read_ops': f"{disk_io.read_count:,}",
                    'write_ops': f"{disk_io.write_count:,}"
                }
        except:
            pass
        return None

    # CPU metrics
    cpu_percent = psutil.cpu_percent(interval=1)
    cpu_count_logical = psutil.cpu_count(logical=True)
    cpu_count_physical = psutil.cpu_count(logical=False)
    load_avg = psutil.getloadavg() if hasattr(psutil, "getloadavg") else (0, 0, 0)
    
    # Memory metrics
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    
    # Disk metrics
    disk = psutil.disk_usage('/')
    disk_io_info = get_disk_io()
    
    # Process metrics
    process_count = len(psutil.pids())
    
    # Active users
    active_users = len(psutil.users())
    
    # Temperature (if available)
    temps = {}
    try:
        temp_sensors = psutil.sensors_temperatures()
        if temp_sensors:
            # Get the most relevant temperature (usually CPU)
            for sensor_name, sensor_list in temp_sensors.items():
                if sensor_list and ('cpu' in sensor_name.lower() or 'core' in sensor_name.lower()):
                    temps['cpu'] = f"{sensor_list[0].current:.1f}°C"
                    break
            # If no CPU temp found, get first available
            if not temps and temp_sensors:
                first_sensor = next(iter(temp_sensors.values()))
                if first_sensor:
                    temps['system'] = f"{first_sensor[0].current:.1f}°C"
    except (AttributeError, OSError):
        pass
    
    # Battery (if available)
    battery_info = {}
    try:
        battery = psutil.sensors_battery()
        if battery:
            battery_info = {
                "percent": f"{battery.percent:.1f}%",
                "plugged_in": "Yes" if battery.power_plugged else "No",
            }
            if battery.secsleft != psutil.POWER_TIME_UNLIMITED and battery.secsleft is not None:
                battery_info["time_left"] = format_uptime(battery.secsleft)
    except (AttributeError, OSError):
        pass
    
    # Docker containers
    docker_info = get_docker_containers()
    
    # Boot time and uptime
    boot_time = psutil.boot_time()
    uptime_seconds = time.time() - boot_time
    
    # Human readable metrics only
    metrics = {
        "manager_version": "1.0.0",
        "software_version": get_version(),
        "system_state": get_state(),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        
        # CPU
        "cpu_usage": f"{cpu_percent:.1f}%",
        "cpu_cores": f"{cpu_count_physical} physical, {cpu_count_logical} logical",
        "load_1m": f"{load_avg[0]:.2f}",
        "load_5m": f"{load_avg[1]:.2f}",
        "load_15m": f"{load_avg[2]:.2f}",
        "load_status": get_load_status(load_avg[0], cpu_count_logical),
        
        # Memory
        "memory_total": format_bytes(mem.total),
        "memory_used": format_bytes(mem.used),
        "memory_available": format_bytes(mem.available),
        "memory_usage": f"{mem.percent:.1f}%",
        
        # Disk
        "disk_total": format_bytes(disk.total),
        "disk_used": format_bytes(disk.used),
        "disk_free": format_bytes(disk.free),
        "disk_usage": f"{(disk.used / disk.total * 100):.1f}%" if disk.total > 0 else "0.0%",
        
        # System
        "process_count": f"{process_count:,}",
        "active_users": f"{active_users:,}",
        "uptime": format_uptime(uptime_seconds),
        "boot_time": datetime.fromtimestamp(boot_time).strftime("%Y-%m-%d %H:%M:%S"),
        "os": platform.system(),
        "architecture": platform.machine(),
        "distro": distro.name(),
        "distro_version": distro.version(),
    }
    
    # Add swap info only if it's being used significantly
    if swap.percent > 5:
        metrics.update({
            "swap_total": format_bytes(swap.total),
            "swap_used": format_bytes(swap.used),
            "swap_usage": f"{swap.percent:.1f}%"
        })
    
    # Add disk I/O info if available
    if disk_io_info:
        metrics["disk_io"] = disk_io_info
    
    # Add temperature data if available
    if temps:
        metrics["temperature"] = temps
    
    # Add battery data if available
    if battery_info:
        metrics["battery"] = battery_info
    
    # Add Docker container info if available
    if docker_info:
        metrics["docker"] = docker_info
    
    return metrics

@router.get("/heartbeat")
def heartbeat():
    return True

@router.get("/health", dependencies=[Depends(get_current_user(USER_ROLE))])
def health_check():
    return get_system_health()

@router.get("/logs", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_logs():
    # Bash command: list containers, exclude device_manager, show last 100 lines each

    def stream():
        try:
            with SSHClient() as sshContext:
                transport = sshContext.client.get_transport()
                channel = transport.open_session()
                channel.set_combine_stderr(True)

                script = """
                /usr/local/bin/docker ps --format '{{.Names}}' | grep -v '^device_manager$' | 
                xargs -I{} sh -c 'echo "=== Logs for container: {} ==="; /usr/local/bin/docker 
                logs --tail 100 {}; echo'
                """

                if get_base_os() == "windows":
                    script = ""

                channel.exec_command(script)

                while True:
                    # Read available output
                    while channel.recv_ready():
                        chunk = channel.recv(1024)
                        decoded = chunk.decode("utf-8", errors="replace")
                        cleaned = clean_ansi_and_whitespace(decoded)
                        yield cleaned + "\n"

                    # Exit loop when command finishes
                    if channel.exit_status_ready():
                        break

                    time.sleep(0.1)  # small delay to avoid busy-wait

                exit_code = channel.recv_exit_status()
                if exit_code != 0:
                    yield f"\nProcess exited with code {exit_code}\n"

        except Exception as e:
            yield f"\nError: {str(e)}\n"

    return StreamingResponse(stream(), media_type="text/plain")

@router.websocket("/ws/ssh")
async def websocket_ssh(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if token is None:
        await websocket.close(code=1008)
        return
    
    try:
        get_current_user_manual(token, required_role="admin")
    except HTTPException:
        await websocket.close(code=1008)
        return
    
    await websocket.accept()

    with SSHClient() as sshContext:
        sshContext.start_interactive_shell()
        try:
            while True:
                # Read from SSH and send to WebSocket
                data = sshContext.interactive_recv()
                if data:
                    await websocket.send_text(data)

                # Read from WebSocket and send to SSH
                try:
                    ws_data = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                    sshContext.interactive_send(ws_data)
                except asyncio.TimeoutError:
                    pass

                await asyncio.sleep(0.01)

        except WebSocketDisconnect:
            pass

@router.post("/date", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_date(date: str = Form(..., example="2025-08-02 18:30:00")):
    """
    Set the system date and sync to hardware clock.
    Example: "2025-08-02 18:30:00"
    """
    # Basic format validation (YYYY-mm-dd HH:MM:SS)
    import re
    if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", date):
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-mm-dd HH:MM:SS")

    base_os = get_base_os()
    cmd = f'date --set="{date}" && hwclock --systohc'

    if base_os == "mac":
        cmd = ""
    elif base_os == "windows":
        cmd = ""

    with SSHClient() as sshContext:
        stdout, stderr, code = sshContext.run_command(cmd)
        if code != 0:
            raise HTTPException(status_code=500, detail=f"Failed to set date: {stderr.strip()}")

    return {"message": date}

@router.post("/reboot", dependencies=[Depends(get_current_user(USER_ROLE))])
def reboot():
    """
    Reboot the system.
    """
    with SSHClient() as sshContext:
        # Run reboot in background so SSH can exit cleanly
        cmd = "nohup reboot >/dev/null 2>&1 &"
        if get_base_os() == "windows":
            cmd = ""
        sshContext.run_command(cmd)
    return {"message": "rebooting in progress"}

@router.post("/restart_services", dependencies=[Depends(get_current_user(USER_ROLE))])
def restart_services():
    """
    Restart services over SSH and stream the output live.
    """

    def stream():
        try:
            with SSHClient() as sshContext:
                transport = sshContext.client.get_transport()
                channel = transport.open_session()
                channel.set_combine_stderr(True)
                script = f"cd {CURRENT_DIR} && /usr/local/bin/docker-compose down && /usr/local/bin/docker-compose up -d"

                if get_base_os() == "windows":
                    script = ""

                channel.exec_command(script)

                while True:
                    # Read available output
                    while channel.recv_ready():
                        chunk = channel.recv(1024)
                        decoded = chunk.decode("utf-8", errors="replace")
                        cleaned = clean_ansi_and_whitespace(decoded)
                        yield cleaned + "\n"

                    # Exit loop when command finishes
                    if channel.exit_status_ready():
                        break

                    time.sleep(0.1)  # small delay to avoid busy-wait

                exit_code = channel.recv_exit_status()
                if exit_code != 0:
                    print("Failed spectacularly")
                    yield f"\nProcess exited with code {exit_code}\n"

        except Exception as e:
            yield f"\nError: {str(e)}\n"

    return StreamingResponse(stream(), media_type="text/plain")
