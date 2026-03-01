from pydantic import BaseModel, Field


class KeybindingsPayload(BaseModel):
    updated_at: int = Field(default=0)
    bindings: dict[str, list[str]] = Field(default_factory=dict)
