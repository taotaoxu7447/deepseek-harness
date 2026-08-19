"""Pure helpers for the Linux desktop shell: health check, server command, downloads."""

from __future__ import annotations

import os
import shutil
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path

APP_URL = 'http://127.0.0.1:3080/'
APP_ID = 'com.deepseek.harness'
APP_NAME = 'DeepSeek Harness'
POLL_SECONDS = 90
SERVE_LOG = Path.home() / '.dsh' / 'serve.log'
WEBKIT_DATA = Path.home() / '.local' / 'share' / 'deepseek-harness' / 'webkit'
WEBKIT_CACHE = Path.home() / '.cache' / 'deepseek-harness' / 'webkit'
DOWNLOADS = Path.home() / 'Downloads'
NPM_PACKAGE = '@deepseek-ai/dsh'


def gui_path(env: Mapping[str, str] | None = None) -> str:
    """Prepend ``~/bin`` and ``~/.local/bin`` so a GNOME launch sees Node and ``dsh``."""
    current = env if env is not None else os.environ
    home = current.get('HOME', str(Path.home()))
    extras = [str(Path(home) / 'bin'), str(Path(home) / '.local' / 'bin')]
    existing = current.get('PATH', '')
    parts = [item for item in extras if item]
    for item in existing.split(':'):
        if item and item not in parts:
            parts.append(item)
    return ':'.join(parts)


def http_ok(url: str = APP_URL, timeout: float = 2.0) -> bool:
    """Return True only when ``url`` answers HTTP 200, matching the macOS shell."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError, ValueError):
        return False


def resolve_web_command(
    env: Mapping[str, str],
    *,
    lookup: Callable[[str], str | None] | None = None,
) -> list[str] | None:
    """Pick the Web UI command: ``DSH_SERVE_CMD``, then ``dsh web``, then ``npx``.

    @param env Process environment used for the override and ``HOME``.
    @param lookup Resolves an executable name to an absolute path; defaults to ``shutil.which``.
    @returns Argument vector, or None when no launcher exists.
    """
    which = lookup if lookup is not None else shutil.which
    custom = env.get('DSH_SERVE_CMD', '').strip()
    if custom:
        return ['bash', '-lc', custom]
    dsh = which('dsh')
    if dsh:
        return [dsh, 'web']
    npx = which('npx')
    if npx:
        return [npx, '--yes', NPM_PACKAGE, 'web']
    return None


def suggested_basename(name: str) -> str:
    """Keep only the final path component so a download cannot escape ~/Downloads."""
    base = Path(name).name
    if not base or base in {'.', '..'}:
        return 'download'
    return base


def uniquify_download(directory: Path, suggested_filename: str) -> Path:
    """Choose a free path in ``directory`` using the macOS ``name-2.ext`` rule."""
    suggested = suggested_basename(suggested_filename)
    stem = Path(suggested).stem
    suffix = Path(suggested).suffix
    n = 0
    while True:
        n += 1
        if n == 1:
            file_name = suggested
        elif suffix == '':
            file_name = f'{stem}-{n}'
        else:
            file_name = f'{stem}-{n}{suffix}'
        candidate = directory / file_name
        if not candidate.exists():
            return candidate
