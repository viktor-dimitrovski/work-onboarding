from fastapi import APIRouter

from app.api.v1.endpoints import assignments, auth, health, progress, reports, tracks, users


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(tracks.router)
api_router.include_router(assignments.router)
api_router.include_router(progress.router)
api_router.include_router(reports.router)
