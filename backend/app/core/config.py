from functools import lru_cache

from pydantic import EmailStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        case_sensitive=True,
        extra='forbid',
    )

    DATABASE_URL: str
    JWT_SECRET_KEY: str
    JWT_REFRESH_SECRET_KEY: str
    APP_ENV: str = 'development'
    CORS_ORIGINS: str = 'http://localhost:3001'
    FIRST_ADMIN_EMAIL: EmailStr
    FIRST_ADMIN_PASSWORD: str

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_ALGORITHM: str = 'HS256'

    OPENAI_API_KEY: str | None = None
    OPENAI_API_BASE: str = 'https://api.openai.com/v1'
    OPENAI_MODEL: str = 'gpt-5.2-pro'
    OPENAI_PROJECT_ID: str | None = None
    OPENAI_TEXT_FORMAT: str | None = None
    OPENAI_INCLUDE_TEMPERATURE: bool = True
    OPENAI_TEXT_VERBOSITY: str | None = None
    OPENAI_MAX_OUTPUT_TOKENS: int | None = None
    OPENAI_TIMEOUT_MS: int = 60_000

    @field_validator('DATABASE_URL')
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if not value.startswith('postgresql'):
            raise ValueError('DATABASE_URL must point to PostgreSQL and start with postgresql')
        return value

    @field_validator('JWT_SECRET_KEY', 'JWT_REFRESH_SECRET_KEY')
    @classmethod
    def validate_jwt_secret_strength(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError('JWT secrets must be at least 32 characters')
        return value

    @field_validator('FIRST_ADMIN_PASSWORD')
    @classmethod
    def validate_first_admin_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError('FIRST_ADMIN_PASSWORD must be at least 8 characters')
        if len(value) > 128:
            raise ValueError('FIRST_ADMIN_PASSWORD must be at most 128 characters')
        return value

    @field_validator('FIRST_ADMIN_EMAIL')
    @classmethod
    def normalize_first_admin_email(cls, value: EmailStr) -> EmailStr:
        # Pydantic will re-validate; we just normalize casing/whitespace.
        return str(value).strip().lower()

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.CORS_ORIGINS.split(',') if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
