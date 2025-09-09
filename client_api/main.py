# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from base import router as base_router
from network import router as network_router
from update import router as update_router
from files import router as files_router
from users import router as user_router

app = FastAPI(
    root_path="/api", docs_url="/docs", redoc_url=None,
    openapi_tags=[
        {
            "name": "Base",
            "description": "Endpoints related to base operations."
        },
        {
            "name": "Network",
            "description": "Endpoints related to network configuration."
        },
        {
            "name": "Update",
            "description": "Endpoints related to software updates."
        },
        {
            "name": "Files",
            "description": "Endpoints related to file system."
        },
        {
            "name": "Users",
            "description": "Endpoints to manage user access."
        }
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(base_router, prefix="/base")
app.include_router(network_router, prefix="/network")
app.include_router(update_router, prefix="/updates")
app.include_router(files_router, prefix="/files")
app.include_router(user_router, prefix="/users")
