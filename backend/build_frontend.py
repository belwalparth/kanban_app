"""Vercel's post-install build hook. Run from any working directory."""
import os
import shutil
import subprocess
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
FRONTEND = BACKEND.parent / "frontend"
STATIC = BACKEND / "app" / "static"


def main():
    npm = "npm.cmd" if os.name == "nt" else "npm"
    environment = os.environ.copy()
    # The frontend needs no app credentials, including at build time.
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET",
                 "OPENROUTER_API_KEY", "DATABASE_URL", "DATABASE_MIGRATION_URL"):
        environment.pop(name, None)
    environment["NEXT_TELEMETRY_DISABLED"] = "1"
    for command in ([npm, "ci", "--include=dev", "--prefer-offline", "--no-audit", "--no-fund"],
                    [npm, "run", "build"]):
        subprocess.run(command, cwd=FRONTEND, env=environment, check=True)
    output = FRONTEND / "out"
    if not (output / "index.html").is_file() or (output / "api").exists():
        raise RuntimeError("Expected a static frontend export without API files")
    # Only replace the generated static directory, never a redirected/symlinked path.
    if STATIC.resolve() != BACKEND / "app" / "static" or STATIC.is_symlink():
        raise RuntimeError("Unexpected frontend destination")
    if STATIC.exists():
        shutil.rmtree(STATIC)
    shutil.copytree(output, STATIC)
    print("Static frontend exported to backend/app/static")


if __name__ == "__main__":
    main()
