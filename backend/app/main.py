from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.services.bootstrap_service import ensure_reference_data


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = SessionLocal()
    try:
        ensure_reference_data(db)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning('Bootstrap seed skipped: %s', exc)
    finally:
        db.close()

    yield


app = FastAPI(
    title='Internal Onboarding Platform API',
    version='0.1.0',
    openapi_url='/api/v1/openapi.json',
    docs_url='/api/v1/docs',
    redoc_url='/api/v1/redoc',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(api_router, prefix='/api/v1')


@app.get('/')
def root() -> dict[str, str]:
    return {'service': 'internal-onboarding-api', 'status': 'running'}
