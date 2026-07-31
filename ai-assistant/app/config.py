from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str  # postgresql://user:pass@host:5432/dbname
    openai_api_key: str  # used only for embeddings (text-embedding-3-small)
    anthropic_api_key: str  # used for answer generation (Claude)
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    generation_model: str = "claude-sonnet-4-6"

    class Config:
        env_file = ".env"


settings = Settings()
