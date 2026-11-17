"""Explicit live check; excluded from routine tests. Run: python -m app.check_ai."""

import asyncio
import json
import sys

from app.openrouter import OpenRouterClient, OpenRouterError

ANSWER_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "arithmetic_answer", "strict": True,
        "schema": {
            "type": "object", "properties": {"answer": {"type": "integer"}},
            "required": ["answer"], "additionalProperties": False,
        },
    },
}


async def check() -> None:
    client = OpenRouterClient()
    result = await client.complete(
        [{"role": "user", "content": "What is 2+2? Return the result in the answer field."}],
        response_format=ANSWER_FORMAT,
    )
    try:
        answer = json.loads(result)
    except ValueError:
        raise OpenRouterError("The arithmetic check did not return valid JSON.") from None
    if answer != {"answer": 4} or type(answer["answer"]) is not int:
        raise OpenRouterError("The arithmetic check did not return the expected integer answer 4.")
    print(f"Model: {client.model}")
    print("2+2 = 4; structured response validated.")


if __name__ == "__main__":
    try:
        asyncio.run(check())
    except OpenRouterError as error:
        print(f"AI check failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
