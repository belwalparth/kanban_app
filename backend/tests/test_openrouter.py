import asyncio
import json

import httpx2 as httpx
import pytest

from app.check_ai import ANSWER_FORMAT, check
from app.openrouter import API_URL, DEFAULT_MODEL, TIMEOUT_SECONDS, OpenRouterClient, OpenRouterError

MESSAGES = [{"role": "user", "content": "2+2"}]


def complete(handler, *, response_format=None, api_key="test-secret"):
    client = OpenRouterClient(api_key=api_key, model=DEFAULT_MODEL, transport=httpx.MockTransport(handler))
    return asyncio.run(client.complete(MESSAGES, response_format=response_format))


def test_request_headers_model_free_only_routing_and_timeout():
    requests = []

    def provider(request):
        requests.append(request)
        assert str(request.url) == API_URL
        assert request.headers["authorization"] == "Bearer test-secret"
        body = json.loads(request.content)
        assert body["model"] == DEFAULT_MODEL
        assert body["messages"] == MESSAGES
        assert body["provider"] == {"require_parameters": True, "max_price": {"prompt": 0, "completion": 0, "request": 0}}
        assert body["max_tokens"] == 2048
        assert "response_format" not in body
        assert request.extensions["timeout"]["read"] == TIMEOUT_SECONDS
        return httpx.Response(200, json={"choices": [{"message": {"content": " 4 "}, "finish_reason": "stop"}]})

    assert complete(provider) == "4"
    assert len(requests) == 1


def test_structured_format_is_forwarded():
    def provider(request):
        assert json.loads(request.content)["response_format"] == ANSWER_FORMAT
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"answer":4}'}}]})
    assert complete(provider, response_format=ANSWER_FORMAT) == '{"answer":4}'


def test_missing_key_never_calls_provider():
    def forbidden(request):
        pytest.fail("Missing credentials must not send a request")
    with pytest.raises(OpenRouterError, match="not configured") as caught:
        complete(forbidden, api_key="  ")
    assert caught.value.status_code == 503


def test_paid_model_is_rejected_without_request():
    client = OpenRouterClient(api_key="test-secret", model="some/paid-model")
    with pytest.raises(OpenRouterError, match=":free"):
        asyncio.run(client.complete(MESSAGES))


def test_environment_configuration(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", " configured-key ")
    monkeypatch.setenv("OPENROUTER_MODEL", "other/model:free")
    client = OpenRouterClient()
    assert client.api_key == "configured-key"
    assert client.model == "other/model:free"


@pytest.mark.parametrize("status, expected, message", [
    (401, 503, "credentials"), (403, 503, "credentials"),
    (429, 503, "rate limit"), (500, 503, "unavailable"), (503, 503, "unavailable"),
    (400, 502, "HTTP 400"), (402, 502, "HTTP 402"), (404, 502, "HTTP 404"),
])
def test_provider_errors_are_safe_and_not_retried(status, expected, message, caplog):
    requests = []
    def provider(request):
        requests.append(request)
        return httpx.Response(status, json={"error": {"message": "test-secret raw private provider response"}})
    with pytest.raises(OpenRouterError, match=message) as caught:
        complete(provider)
    assert caught.value.status_code == expected
    assert len(requests) == 1
    assert "test-secret" not in str(caught.value)
    assert "raw private" not in str(caught.value)
    assert "test-secret" not in caplog.text


@pytest.mark.parametrize("failure, status, message", [
    (httpx.ReadTimeout("test-secret"), 504, "timed out"),
    (httpx.ConnectError("test-secret"), 502, "connect"),
])
def test_network_errors_hide_request_details(failure, status, message):
    def provider(request):
        raise failure
    with pytest.raises(OpenRouterError, match=message) as caught:
        complete(provider)
    assert caught.value.status_code == status
    assert "test-secret" not in str(caught.value)


@pytest.mark.parametrize("body", [
    {}, {"error": {"message": "private error"}}, {"choices": []}, {"choices": [None]},
    {"choices": [{"message": {"content": None}}]},
    {"choices": [{"message": {"content": " "}}]},
    {"choices": [{"message": {"content": [{"type": "text", "text": "4"}]}}]},
])
def test_bad_or_empty_provider_responses(body):
    with pytest.raises(OpenRouterError):
        complete(lambda request: httpx.Response(200, json=body))


def test_invalid_json_response():
    with pytest.raises(OpenRouterError, match="invalid response"):
        complete(lambda request: httpx.Response(200, text="not-json"))


def test_truncated_response_is_not_treated_as_success():
    with pytest.raises(OpenRouterError, match="output limit"):
        complete(lambda request: httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": "partial"}}]}))


@pytest.mark.parametrize("reason", ["error", "content_filter", "tool_calls"])
def test_incomplete_answers_are_rejected(reason):
    with pytest.raises(OpenRouterError, match="did not complete"):
        complete(lambda request: httpx.Response(200, json={"choices": [{"finish_reason": reason, "message": {"content": "partial"}}]}))


@pytest.mark.parametrize("answer, success", [('{"answer":4}', True), ('{"answer":5}', False), ('{"answer":4.0}', False), ('not-json', False)])
def test_live_check_validation_is_tested_offline(monkeypatch, capsys, answer, success):
    async def fake_complete(self, messages, *, response_format):
        assert "2+2" in messages[0]["content"]
        assert response_format == ANSWER_FORMAT
        return answer
    monkeypatch.setattr(OpenRouterClient, "complete", fake_complete)
    if success:
        asyncio.run(check())
        assert "2+2 = 4" in capsys.readouterr().out
    else:
        with pytest.raises(OpenRouterError):
            asyncio.run(check())


def test_total_deadline_bounds_a_slow_response_and_closes_transport(monkeypatch):
    from app import openrouter
    monkeypatch.setattr(openrouter, "TOTAL_TIMEOUT_SECONDS", 0.025)
    calls = []
    closed = []
    class SlowBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(100):
                await asyncio.sleep(0.01)
                yield b" "
        async def aclose(self):
            closed.append(True)
    def provider(request):
        calls.append(request)
        return httpx.Response(200, stream=SlowBody())
    with pytest.raises(OpenRouterError, match="timed out") as caught:
        complete(provider)
    assert caught.value.status_code == 504
    assert len(calls) == 1
    assert closed
