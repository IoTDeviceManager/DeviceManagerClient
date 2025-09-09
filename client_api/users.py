# network.py
import jwt
import json
import bcrypt
import subprocess
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timedelta
from fastapi.security import OAuth2PasswordBearer
from fastapi import APIRouter, Form, HTTPException, Depends
from helpers import ADMIN_ROLE

router = APIRouter(tags=["Users"])

# === Utils ===
def get_boot_time():
    output = subprocess.check_output(["cat", "/proc/stat"]).decode()
    for line in output.splitlines():
        if line.startswith("btime"):
            return str(line.split()[1])
    return "0"

# === Config ===
USERS_FILE = Path("/etc/device.d/users.json")
JWT_SECRET = get_boot_time()
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_MINUTES = 1440
DEFAULT_USER = "admin"
DEFAULT_PASS = "admin"
DEFAULT_ROLE = ADMIN_ROLE

# === Models ===
class Token(BaseModel):
    access_token: str
    token_type: str
    role: str

class User(BaseModel):
    username: str
    role: str

# === File Helpers ===
def init_users():
    if not USERS_FILE.exists():
        hashed = bcrypt.hashpw(DEFAULT_PASS.encode(), bcrypt.gensalt()).decode()
        USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(USERS_FILE, "w") as f:
            json.dump(
                [{"username": DEFAULT_USER, "password": hashed, "role": DEFAULT_ROLE}],
                f
            )

def load_users():
    if not USERS_FILE.exists():
        init_users()
    with open(USERS_FILE, "r") as f:
        return json.load(f)

def save_users(users):
    with open(USERS_FILE, "w") as f:
        json.dump(users, f)

# === Password / Auth Helpers ===
def verify_password(plain_password: str, hashed_password: str):
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.now() + (expires_delta or timedelta(minutes=JWT_EXPIRATION_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def authenticate_user(username: str, password: str):
    users = load_users()
    for u in users:
        if u["username"] == username and verify_password(password, u["password"]):
            return u
    return None

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/users/login")

def get_current_user(required_role: str = None):
    def dependency(token: str = Depends(oauth2_scheme)):
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            username = payload.get("sub")
            role = payload.get("role")
            if not username or not role:
                raise HTTPException(status_code=401, detail="Invalid token")
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid token")

        if required_role and role != required_role:
            # Allow admin to bypass lower-role restrictions
            if role != "admin":
                raise HTTPException(status_code=403, detail="Insufficient privileges")

        return {"username": username, "role": role}
    return dependency

def get_current_user_manual(token: str, required_role: str = None):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role")

        if not username or not role:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")

        # Role enforcement with admin override
        if required_role and role != required_role:
            if role != "admin":
                raise HTTPException(status_code=403, detail="Insufficient privileges")

        return {"username": username, "role": role}

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# === Routes ===
@router.post("/login", response_model=Token)
def login(username: str = Form(...), password: str = Form(...)):
    user = authenticate_user(username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token({"sub": user["username"], "role": user["role"]})
    return {"access_token": token, "token_type": "bearer", "role": user["role"]}

@router.get("/users", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def list_users():
    users = load_users()
    return [{"username": u["username"], "role": u["role"]} for u in users]

@router.post("/users", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def create_user(username: str = Form(...), password: str = Form(...), role: str = Form(...)):
    users = load_users()
    if any(u["username"] == username for u in users):
        raise HTTPException(status_code=400, detail="User already exists")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    users.append({"username": username, "password": hashed, "role": role})
    save_users(users)
    return {"status": "success"}

@router.put("/users/{username}")
def update_user(
    username: str,
    password: str = Form(None),
    role: str = Form(None),
    current_user=Depends(get_current_user())
):
    users = load_users()
    target = next((u for u in users if u["username"] == username), None)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Only admin or the user themselves can modify
    if current_user["username"] != username and current_user["role"] != ADMIN_ROLE:
        raise HTTPException(status_code=403, detail="Cannot modify other users")

    # Password update allowed for self or admins
    if password:
        target["password"] = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # Role update only if admin
    if role:
        if current_user["role"] != ADMIN_ROLE:
            raise HTTPException(status_code=403, detail="Only admins can update roles")

        # Prevent admin removing their own admin role
        if username == current_user["username"] and role != ADMIN_ROLE:
            raise HTTPException(status_code=403, detail="Admin cannot self-update roll. Do so with another admin account.")

        # Otherwise, update role
        target["role"] = role

    save_users(users)
    return {"status": "success"}

@router.delete("/users/{username}")
def delete_user(username: str, current_user=Depends(get_current_user(ADMIN_ROLE))):
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    users = load_users()
    users = [u for u in users if u["username"] != username]
    save_users(users)
    return {"status": "success"}

@router.get("/check_token")
def check_token(_: str = Depends(get_current_user())):
    return True

init_users()
HUNDRED_YEARS_IN_DAYS = 36500
INTERNAL_TOKEN = create_access_token({"sub": "internal_service", "role": ADMIN_ROLE}, expires_delta=timedelta(days=HUNDRED_YEARS_IN_DAYS))
