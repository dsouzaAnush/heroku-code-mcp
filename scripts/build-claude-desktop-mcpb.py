#!/usr/bin/env python3
"""Build a branded Claude Desktop MCPB bundle for Heroku Code MCP."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_ROOT = ROOT / "dist" / "mcpb" / "heroku-code-mcp"
OUTPUT = ROOT / "dist" / "mcpb" / "heroku-code-mcp.mcpb"
HEROKU_LOGO = ROOT / "assets" / "heroku-logo.png"
WRAPPER = ROOT / "scripts" / "claude-desktop-heroku-mcp.sh"


def build_icon(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HEROKU_LOGO, destination)


def write_manifest(destination: Path) -> None:
    manifest = {
        "$schema": "https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.3.schema.json",
        "manifest_version": "0.3",
        "name": "heroku-code-mcp",
        "display_name": "Heroku Code MCP",
        "version": "0.1.0",
        "description": "Use Heroku Platform API operations from Claude Desktop through a compact MCP tool surface.",
        "long_description": (
            "Heroku Code MCP gives Claude Desktop three live Heroku tools: "
            "auth_status, search, and execute. It runs locally, reads the private "
            "Heroku token store on this machine, and supports confirmed write operations."
        ),
        "author": {
            "name": "Anush Dsouza",
            "url": "https://github.com/dsouzaAnush"
        },
        "repository": {
            "type": "git",
            "url": "https://github.com/dsouzaAnush/heroku-code-mcp"
        },
        "homepage": "https://github.com/dsouzaAnush/heroku-code-mcp",
        "documentation": "https://github.com/dsouzaAnush/heroku-code-mcp#integrate-with-claude",
        "support": "https://github.com/dsouzaAnush/heroku-code-mcp/issues",
        "icon": "icon.png",
        "icons": [
            {"src": "icon.png", "size": "512x512", "theme": "light"},
            {"src": "icon.png", "size": "512x512", "theme": "dark"}
        ],
        "server": {
            "type": "binary",
            "entry_point": "server/claude-desktop-heroku-mcp.sh",
            "mcp_config": {
                "command": "${__dirname}/server/claude-desktop-heroku-mcp.sh",
                "args": [],
                "env": {
                    "HEROKU_CODE_MCP_ENV_FILE": "${HOME}/Library/Application Support/Claude/heroku-code-mcp/env.sh"
                }
            }
        },
        "tools": [
            {
                "name": "auth_status",
                "description": "Check whether Claude Desktop is authenticated with Heroku."
            },
            {
                "name": "search",
                "description": "Search Heroku Platform API operations from natural language intent."
            },
            {
                "name": "execute",
                "description": "Validate and execute a selected Heroku Platform API operation."
            }
        ],
        "keywords": ["heroku", "mcp", "claude", "deployment", "platform-api"],
        "license": "ISC",
        "privacy_policies": ["https://www.salesforce.com/company/privacy/"],
        "compatibility": {
            "claude_desktop": ">=1.0.0",
            "platforms": ["darwin"]
        }
    }
    destination.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def copy_wrapper(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(WRAPPER, destination)
    mode = destination.stat().st_mode
    destination.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def main() -> None:
    if BUILD_ROOT.exists():
        shutil.rmtree(BUILD_ROOT)
    BUILD_ROOT.mkdir(parents=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    build_icon(BUILD_ROOT / "icon.png")
    copy_wrapper(BUILD_ROOT / "server" / "claude-desktop-heroku-mcp.sh")
    write_manifest(BUILD_ROOT / "manifest.json")

    env = {**os.environ, "NO_COLOR": "1"}
    subprocess.run(
        ["npx", "-y", "@anthropic-ai/mcpb", "validate", str(BUILD_ROOT)],
        cwd=ROOT,
        check=True,
        env=env,
    )
    subprocess.run(
        ["npx", "-y", "@anthropic-ai/mcpb", "pack", str(BUILD_ROOT), str(OUTPUT)],
        cwd=ROOT,
        check=True,
        env=env,
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
