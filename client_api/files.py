import os
import hmac
import stat
import time
import base64
import hashlib
import zipfile
from io import BytesIO
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Depends, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
from helpers import ADMIN_ROLE, STAGE_DIR, SSHClient, logger
from users import JWT_SECRET, get_current_user

upload_progress = {}
EXPIRATION_SECONDS = 60
router = APIRouter(tags=["Files"])

class FileEntry(BaseModel):
    name: str
    is_dir: bool
    size: int
    mtime: int  # epoch seconds

def is_dir(sftp_attrs):
    if stat.S_ISDIR(sftp_attrs):
        return True
    return False

def create_signed_url(path: str) -> str:
    expires = int(time.time()) + EXPIRATION_SECONDS
    data = f"{path}:{expires}"
    sig = hmac.new(str(JWT_SECRET).encode(), data.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode()
    return f"/files/signed-download?path={quote(path)}&expires={expires}&sig={sig_b64}"

def verify_signature(path: str, expires: int, sig: str) -> bool:
    if time.time() > int(expires):
        return False

    data = f"{path}:{expires}"
    expected_sig = hmac.new(str(JWT_SECRET).encode(), data.encode(), hashlib.sha256).digest()
    expected_b64 = base64.urlsafe_b64encode(expected_sig).decode()
    return hmac.compare_digest(expected_b64, sig)

def delete_path_recursive(sftp, path: str):
    try:
        attr = sftp.stat(path)
        if attr.st_mode & 0o040000:  # Directory
            for item in sftp.listdir_attr(path):
                item_path = os.path.join(path, item.filename)
                delete_path_recursive(sftp, item_path)
            sftp.rmdir(path)
        else:
            sftp.remove(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Path not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete path: {str(e)}")

@router.get("/list", response_model=List[FileEntry], dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def list_files(path: str = Query("/", description="Directory to list")):
    with SSHClient() as ssh:
        sftp = ssh.open_sftp()
        try:
            files = sftp.listdir_attr(path)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Directory not found")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        entries = []
        for f in files:
            entries.append(FileEntry(
                name=f.filename,
                is_dir=is_dir(f.st_mode),
                size=f.st_size,
                mtime=int(f.st_mtime)
            ))

        entries.sort(key=lambda e: (not e.is_dir, e.name.lower()))
        return entries

@router.get("/download-url", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def get_signed_url(path: str):
    return {"url": create_signed_url(path)}

@router.get("/signed-download")
def signed_download(
    path: str,
    expires: int,
    sig: str,
):
    if not verify_signature(path, expires, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired signature")

    ssh = SSHClient()
    ssh.connect()

    try:
        sftp = ssh.open_sftp()
        file_attr = sftp.stat(path)
        is_directory = is_dir(file_attr.st_mode)
        sftp.close()

        basename = os.path.basename(path.rstrip("/"))
        staged_path = os.path.join(STAGE_DIR, basename)
        orig_path = path

        # Move original file/dir to staged path (mv)
        cmd_mv_to_stage = f"mv '{orig_path}' '{staged_path}'"
        stdout, stderr, code = ssh.run_command(cmd_mv_to_stage)
        if code != 0:
            raise HTTPException(status_code=500, detail=f"Failed to move to stage: {stderr.strip()}")

    finally:
        ssh.close()

    def move_back():
        ssh_local = SSHClient()
        try:
            ssh_local.connect()
            cmd_mv_back = f"mv '{staged_path}' '{orig_path}'"
            stdout_b, stderr_b, code_b = ssh_local.run_command(cmd_mv_back)
            if code_b != 0:
                logger.warning(f"Warning: failed to move back file: {stderr_b.strip()}")
        finally:
            ssh_local.close()

    def wrap_generator(generator_func):
        # Wrap generator so we can run move_back() after streaming ends
        def generator_wrapper():
            try:
                yield from generator_func()
            finally:
                move_back()
        return generator_wrapper

    if not is_directory:
        def file_iter():
            with open(staged_path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk

        headers = {"Content-Disposition": f'attachment; filename="{basename}"'}
        return StreamingResponse(wrap_generator(file_iter)(), media_type="application/octet-stream", headers=headers)

    else:
        def zip_stream():
            zip_buffer = BytesIO()
            with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(staged_path):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, staged_path)
                        zipf.write(full_path, rel_path)
            zip_buffer.seek(0)
            yield from zip_buffer

        headers = {"Content-Disposition": f'attachment; filename="{basename}.zip"'}
        return StreamingResponse(wrap_generator(zip_stream)(), media_type="application/zip", headers=headers)

@router.post("/rename", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def rename_file(
    oldPath: str = Form(...),
    newPath: str = Form(...)
):
    with SSHClient() as ssh:
        sftp = ssh.open_sftp()
        try:
            sftp.rename(oldPath, newPath)
            return {"detail": f"Renamed to: {newPath}"}
        finally:
            sftp.close()

@router.post("/new_folder", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def new_folder(
    newPath: str = Form(...)
):
    with SSHClient() as ssh:
        sftp = ssh.open_sftp()
        try:
            sftp.mkdir(newPath)
            return {"detail": f"New folder: {newPath}"}
        finally:
            sftp.close()

@router.post("/new_file", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def new_file(
    newPath: str = Form(...)
):
    with SSHClient() as ssh:
        sftp = ssh.open_sftp()
        try:
            with sftp.file(newPath, mode='w') as f:
                f.write("")  # Create empty file
            return {"detail": f"New file: {newPath}"}
        finally:
            sftp.close()

@router.post("/upload", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def upload_file(
    path: str = Query(...),
    upload_id: str = Query(...),
    upload: UploadFile = File(...),
):
    # Write to the shared mount path that the host can access
    temp_path = f"/{STAGE_DIR}/{upload.filename}"  # container's mount point

    upload.file.seek(0, 2)
    total_size = upload.file.tell()
    upload.file.seek(0)

    bytes_written = 0
    with open(temp_path, "wb") as f:
        while chunk := upload.file.read(32768):
            f.write(chunk)
            bytes_written += len(chunk)
            upload_progress[upload_id] = int((bytes_written / total_size) * 100)

    # Move file into final host location using SSH context
    with SSHClient() as ssh:
        cmd = f"mv '{temp_path}' '{path.rstrip('/')}/{upload.filename}'"
        _, stderr, code = ssh.run_command(cmd)
        if code != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to move file to {path}: {stderr.strip()}",
            )

    upload_progress[upload_id] = 100
    return {"upload_id": upload_id}

@router.get("/upload-progress")
def get_upload_progress(upload_id: str):
    progress = upload_progress.get(upload_id, 0)
    return {"progress": progress}

@router.post("/delete", dependencies=[Depends(get_current_user(ADMIN_ROLE))])
def delete_file(
    path: str = Query(..., description="Remote file or folder to delete")
):
    with SSHClient() as ssh:
        sftp = ssh.open_sftp()
        try:
            delete_path_recursive(sftp, path)
            return {"detail": f"Deleted: {path}"}
        finally:
            sftp.close()
