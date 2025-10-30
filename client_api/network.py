# network.py
from pathlib import Path
from enum import Enum
from fastapi import APIRouter, Form, HTTPException, Body, Depends
from helpers import USER_ROLE, SSHClient, get_base_os
from users import get_current_user

def netmask_to_cidr(netmask: str) -> int:
    binary_str = ''.join(bin(int(octet))[2:].zfill(8) for octet in netmask.split('.'))
    return binary_str.count('1')

def get_sysfs_interfaces():
    with SSHClient() as sshContext:
        base_os = get_base_os()
        cmd = r"""
        for iface in /sys/class/net/*; do
            name=$(basename "$iface")
            if [ -d "$iface/device" ]; then
                if [ -d "$iface/wireless" ]; then
                    echo "$name:wifi"
                else
                    echo "$name:ethernet"
                fi
            else
                echo "$name:virtual"
            fi
        done
        """
        if base_os == "mac":
            cmd = ""
        elif base_os = "windows":
            cmd = ""
        stdout, _, _ = sshContext.run_command(cmd)

    ethernet = []
    wifi = []

    for line in stdout.strip().split("\n"):
        if not line:
            continue
        name, dev_type = line.split(":", 1)
        if dev_type == "ethernet":
            ethernet.append(name)
        elif dev_type == "wifi":
            wifi.append(name)

    return {
        "ethernet": ethernet,
        "wifi": wifi
    }

def get_wifi_ssids():
    with SSHClient() as sshContext:
        stdout, _, _ = sshContext.run_command(
            "nmcli -t -f SSID device wifi list | sort -u"
        )

    # Split by lines, remove empty entries (hidden SSIDs), remove duplicates
    ssids = sorted(set(filter(None, stdout.strip().split("\n"))))
    return ssids

router = APIRouter(tags=["Network"])
HOSTS_FILE = Path("/etc/hosts")
INTERFACES = get_sysfs_interfaces()
InterfaceEnum = Enum("EthernetInterfaceEnum", {name: name for name in INTERFACES["ethernet"] + INTERFACES["wifi"]})
EthernetInterfaceEnum = Enum("EthernetInterfaceEnum", {eth: eth for eth in INTERFACES["ethernet"]})
WiFiInterfaceEnum = Enum("WiFiInterfaceEnum", {wifi: wifi for wifi in INTERFACES["wifi"]})

@router.get("/list_interfaces", dependencies=[Depends(get_current_user(USER_ROLE))])
def list_network_interfaces():
    return INTERFACES

@router.get("/wifi/ssids", dependencies=[Depends(get_current_user(USER_ROLE))])
def list_wifi_ssids():
    return get_wifi_ssids()

@router.get("/dns/local", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_local_dns():
    try:
        data = HOSTS_FILE.read_text()
        return {"content": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/dns/local", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_local_dns(content: str = Body(..., embed=True)):
    """
    Overwrite /etc/hosts with the provided content.
    The request body should be: {"content": "<new file contents>"}.
    """
    try:
        HOSTS_FILE.write_text(content)
        return {"status": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/interface/{interface}", dependencies=[Depends(get_current_user(USER_ROLE))])
def get_network_interface_details(interface: InterfaceEnum):
    with SSHClient() as sshContext:
        # Run nmcli device show to get interface details and connection name
        stdout, stderr, code = sshContext.run_command(f"nmcli device show {interface.value}")
        if code != 0:
            raise HTTPException(status_code=500, detail=f"nmcli device show failed: {stderr.strip()}")

        parsed = {}
        for line in stdout.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                parsed[key.strip()] = value.strip()

        connection_name = parsed.get("GENERAL.CONNECTION")
        method = "—"

        if connection_name and connection_name != "--":
            # Run nmcli connection show <connection_name> to get IP method
            conn_stdout, conn_stderr, conn_code = sshContext.run_command(f"nmcli connection show '{connection_name}'")
            if conn_code == 0:
                for line in conn_stdout.splitlines():
                    if line.startswith("ipv4.method:"):
                        method = line.split(":", 1)[1].strip()
                        break

        method_map = {
            "auto": "DHCP",
            "manual": "Static",
            "disabled": "Disabled",
            "link-local": "Link-Local",
            "shared": "Shared (NAT)",
            "relay": "DHCP Relay",
        }
        friendly = method_map.get(method, "Unmanaged")

        return {
            "interface": interface.value,
            "type": parsed.get("GENERAL.TYPE", "—"),
            "mtu": parsed.get("GENERAL.MTU", "—"),
            "status": parsed.get("WIRED-PROPERTIES.CARRIER", "—"),
            "mac": parsed.get("GENERAL.HWADDR", "—"),
            "dns_1": parsed.get("IP4.DNS[1]", "—"),
            "dns_2": parsed.get("IP4.DNS[2]", "—"),
            "mode": friendly,
            "ipv4_addr": parsed.get("IP4.ADDRESS[1]", "—"),
            "ipv4_gateway": parsed.get("IP4.GATEWAY", "—"),
            "ipv6_addr": parsed.get("IP6.ADDRESS[1]", "—"),
            "ipv6_gateway": parsed.get("IP6.GATEWAY", "—"),
        }

@router.post("/ethernet/dhcp", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_eth_dhcp(interface: EthernetInterfaceEnum = Form(...)):
    try:
        with SSHClient() as sshContext:
            # Step 1: Disconnect the interface (ignore errors)
            sshContext.run_command(f"nmcli device disconnect {interface.value} 2>/dev/null || true")

            # Step 2: Delete existing temp connection (ignore errors)
            sshContext.run_command(f"nmcli con delete temp_{interface.value} 2>/dev/null || true")

            # Step 3: Add new ethernet connection with DHCP (auto IP)
            add_cmd = (
                f"nmcli con add type ethernet ifname {interface.value} "
                f"con-name temp_{interface.value} ipv4.method auto"
            )
            stdout, stderr, code = sshContext.run_command(add_cmd)
            if code != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to add DHCP connection temp_{interface.value}: {(stderr or stdout).strip()}"
                )

            # Step 4: Bring up the new connection
            up_cmd = f"nmcli con up temp_{interface.value}"
            stdout, stderr, code = sshContext.run_command(up_cmd)
            combined_output = (stdout + "\n" + stderr).lower()
            if code != 0 or "error" in combined_output:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to activate DHCP connection temp_{interface.value}: {(stderr or stdout).strip()}"
                )

            # Optional Step 5: Verify the interface is connected
            verify_cmd = f"nmcli -t -f GENERAL.STATE device show {interface.value}"
            stdout, stderr, code = sshContext.run_command(verify_cmd)
            if "100" not in stdout:
                raise HTTPException(
                    status_code=500,
                    detail=f"Interface {interface.value} did not reach connected state"
                )

        return {"status": "connected", "mode": "dhcp"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ethernet/static", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_eth_static(
    interface: EthernetInterfaceEnum = Form(...),
    ip_address: str = Form(...),
    netmask: str = Form(default="255.255.255.0"),
    gateway: str = Form(...),
    dns: str = Form(default="8.8.8.8,1.1.1.1")
):
    cidr = netmask_to_cidr(netmask)

    try:
        with SSHClient() as sshContext:
            # Step 1: Disconnect the interface (ignore errors)
            sshContext.run_command(f"nmcli device disconnect {interface.value} 2>/dev/null || true")

            # Step 2: Delete existing temp connection (ignore errors)
            sshContext.run_command(f"nmcli con delete temp_{interface.value} 2>/dev/null || true")

            # Step 3: Add new ethernet connection with static IP config
            add_cmd = (
                f"nmcli con add type ethernet ifname {interface.value} con-name temp_{interface.value} "
                f"ipv4.method manual ipv4.addresses {ip_address}/{cidr} ipv4.gateway {gateway} "
                f"ipv4.dns \"{dns}\""
            )
            stdout, stderr, code = sshContext.run_command(add_cmd)
            if code != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to add connection temp_{interface.value}: {(stderr or stdout).strip()}"
                )

            # Step 4: Bring up the new connection
            up_cmd = f"nmcli con up temp_{interface.value}"
            stdout, stderr, code = sshContext.run_command(up_cmd)
            combined_output = (stdout + "\n" + stderr).lower()
            if code != 0 or "error" in combined_output:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to activate connection temp_{interface.value}: {(stderr or stdout).strip()}"
                )

            # Optional Step 5: Verify the interface is connected
            verify_cmd = f"nmcli -t -f GENERAL.STATE device show {interface.value}"
            stdout, stderr, code = sshContext.run_command(verify_cmd)
            if "100" not in stdout:
                raise HTTPException(
                    status_code=500,
                    detail=f"Interface {interface.value} did not reach connected state"
                )

        return {"status": "connected", "mode": "static"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/wifi/dhcp", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_wifi_dhcp(
    interface: WiFiInterfaceEnum = Form(...),
    ssid: str = Form(...),
    password: str = Form(...)
):
    try:
        with SSHClient() as sshContext:
            # Step 1: Turn Wi-Fi on
            stdout, stderr, code = sshContext.run_command("nmcli radio wifi on")
            if code != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to enable Wi-Fi: {(stderr or stdout).strip()}"
                )

            # Step 2: Delete existing temp connection (ignore failures)
            sshContext.run_command(
                f"nmcli con delete temp_{interface.value}_wifi 2>/dev/null || true"
            )

            # Step 3: Attempt to connect
            connect_cmd = (
                f"nmcli device wifi connect '{ssid}' "
                f"password '{password}' ifname {interface.value} "
                f"name temp_{interface.value}_wifi"
            )
            stdout, stderr, code = sshContext.run_command(connect_cmd)

            combined_output = (stdout + "\n" + stderr).lower()

            if code != 0 or "error" in combined_output:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to connect {interface.value} to Wi-Fi '{ssid}': {(stderr or stdout).strip()}"
                )

            # Optional: Verify the device is actually connected
            verify_cmd = f"nmcli -t -f GENERAL.STATE device show {interface.value}"
            stdout, stderr, code = sshContext.run_command(verify_cmd)
            if "100" not in stdout:  # 100 means connected
                raise HTTPException(
                    status_code=500,
                    detail=f"Interface {interface.value} did not reach connected state"
                )

        return {"status": "connected", "ssid": ssid}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/wifi/static", dependencies=[Depends(get_current_user(USER_ROLE))])
def set_wifi_static(
    interface: WiFiInterfaceEnum = Form(...),
    ssid: str = Form(...),
    password: str = Form(...),
    ip_address: str = Form(...),
    netmask: str = Form(default="255.255.255.0"),
    gateway: str = Form(...),
    dns: str = Form(default="8.8.8.8,1.1.1.1")
):
    cidr = netmask_to_cidr(netmask)  # Your helper to convert netmask to CIDR

    try:
        with SSHClient() as sshContext:
            # Step 1: Enable Wi-Fi
            stdout, stderr, code = sshContext.run_command("nmcli radio wifi on")
            if code != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to enable Wi-Fi: {(stderr or stdout).strip()}"
                )

            # Step 2: Delete existing temp connection (ignore failure)
            sshContext.run_command(f"nmcli con delete temp_{interface.value}_wifi 2>/dev/null || true")

            # Step 3: Connect to Wi-Fi (creates the connection profile)
            connect_cmd = (
                f"nmcli device wifi connect '{ssid}' password '{password}' "
                f"ifname {interface.value} name temp_{interface.value}_wifi"
            )
            stdout, stderr, code = sshContext.run_command(connect_cmd)
            combined_output = (stdout + "\n" + stderr).lower()
            if code != 0 or "error" in combined_output:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to connect {interface.value} to Wi-Fi '{ssid}': {(stderr or stdout).strip()}"
                )

            # Step 4: Modify connection to use static IP
            mod_cmd = (
                f"nmcli con mod temp_{interface.value}_wifi ipv4.method manual "
                f"ipv4.addresses {ip_address}/{cidr} ipv4.gateway {gateway} ipv4.dns {dns}"
            )
            stdout, stderr, code = sshContext.run_command(mod_cmd)
            if code != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to set static IP configuration: {(stderr or stdout).strip()}"
                )

            # Step 5: Bring up the connection with static config
            up_cmd = f"nmcli con up temp_{interface.value}_wifi"
            stdout, stderr, code = sshContext.run_command(up_cmd)
            combined_output = (stdout + "\n" + stderr).lower()
            if code != 0 or "error" in combined_output:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to activate static IP connection: {(stderr or stdout).strip()}"
                )

            # Step 6 (optional): Verify the interface is connected
            verify_cmd = f"nmcli -t -f GENERAL.STATE device show {interface.value}"
            stdout, stderr, code = sshContext.run_command(verify_cmd)
            if "100" not in stdout:
                raise HTTPException(
                    status_code=500,
                    detail=f"Interface {interface.value} did not reach connected state"
                )

        return {"status": "connected", "ssid": ssid, "ip": ip_address}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    