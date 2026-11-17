import os

import httpx2 as httpx

DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl:free"
API_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_SECONDS = 30.0


class OpenRouterError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class OpenRouterClient:
    def __init__(self, *, api_key: str | None = None, model: str | None = None,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = (api_key if api_key is not None else os.environ.get("OPENROUTER_API_KEY", "")).strip()
        self.model = model if model is not None else os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)
        self.transport = transport

    async def complete(self, messages: list[dict[str, str]], *, response_format: dict | None = None,
                       max_tokens: int = 2048) -> str:
        if not self.api_key:
            raise OpenRouterError("OPENROUTER_API_KEY is not configured.", 503)
        if not self.model.endswith(":free"):
            raise OpenRouterError("OPENROUTER_MODEL must be an explicit :free model.", 503)
        payload = {
            "model": self.model, "messages": messages, "max_tokens": max_tokens,
            "provider": {"require_parameters": True, "max_price": {"prompt": 0, "completion": 0, "request": 0}},
        }
        if response_format is not None:
            payload["response_format"] = response_format
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=self.transport) as client:
                response = await client.post(API_URL, headers={"Authorization": f"Bearer {self.api_key}"}, json=payload)
        except httpx.TimeoutException:
            raise OpenRouterError("OpenRouter request timed out. Please try again later.", 504) from None
        except httpx.RequestError:
            raise OpenRouterError("Couldn't connect to OpenRouter. Please try again later.") from None

        if response.status_code in (401, 403):
            raise OpenRouterError("OpenRouter rejected the API credentials.", 503)
        if response.status_code == 429:
            raise OpenRouterError("OpenRouter rate limit reached. Please try again later.", 503)
        if response.status_code >= 500:
            raise OpenRouterError("OpenRouter is unavailable. Please try again later.", 503)
        if response.status_code != 200:
            raise OpenRouterError(f"OpenRouter rejected the request (HTTP {response.status_code}).")
        try:
            choice = response.json()["choices"][0]
            content = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise OpenRouterError("OpenRouter returned an invalid response.") from None
        if choice.get("finish_reason") == "length":
            raise OpenRouterError("OpenRouter's response exceeded the output limit.")
        if choice.get("finish_reason") not in (None, "stop"):
            raise OpenRouterError("OpenRouter did not complete its answer.")
        if not isinstance(content, str) or not content.strip():
            raise OpenRouterError("OpenRouter returned an empty or invalid answer.")
        return content.strip()
