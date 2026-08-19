"""Keyless tests for the Linux desktop-shell helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent))

from helpers import (
    gui_path,
    resolve_web_command,
    suggested_basename,
    uniquify_download,
)


class SuggestedBasenameTests(unittest.TestCase):
    def test_keeps_plain_name(self) -> None:
        self.assertEqual(suggested_basename('session.zip'), 'session.zip')

    def test_strips_directory_components(self) -> None:
        self.assertEqual(suggested_basename('../etc/passwd'), 'passwd')
        self.assertEqual(suggested_basename('/tmp/a/b.log'), 'b.log')

    def test_rejects_empty_and_dots(self) -> None:
        self.assertEqual(suggested_basename(''), 'download')
        self.assertEqual(suggested_basename('.'), 'download')
        self.assertEqual(suggested_basename('..'), 'download')


class UniquifyDownloadTests(unittest.TestCase):
    def test_first_candidate_keeps_suggested_name(self) -> None:
        with TemporaryDirectory() as raw:
            directory = Path(raw)
            self.assertEqual(uniquify_download(directory, 'notes.zip'), directory / 'notes.zip')

    def test_collisions_append_hyphen_index(self) -> None:
        with TemporaryDirectory() as raw:
            directory = Path(raw)
            (directory / 'notes.zip').write_bytes(b'')
            (directory / 'notes-2.zip').write_bytes(b'')
            self.assertEqual(uniquify_download(directory, 'notes.zip'), directory / 'notes-3.zip')

    def test_extensionless_names_append_index(self) -> None:
        with TemporaryDirectory() as raw:
            directory = Path(raw)
            (directory / 'notes').write_bytes(b'')
            self.assertEqual(uniquify_download(directory, 'notes'), directory / 'notes-2')


class ResolveWebCommandTests(unittest.TestCase):
    def test_env_override_wins(self) -> None:
        command = resolve_web_command(
            {'DSH_SERVE_CMD': 'pnpm dsh web'},
            lookup=lambda _: None,
        )
        self.assertEqual(command, ['bash', '-lc', 'pnpm dsh web'])

    def test_prefers_dsh_on_path(self) -> None:
        command = resolve_web_command(
            {},
            lookup=lambda name: '/opt/bin/dsh' if name == 'dsh' else None,
        )
        self.assertEqual(command, ['/opt/bin/dsh', 'web'])

    def test_falls_back_to_npx(self) -> None:
        command = resolve_web_command(
            {},
            lookup=lambda name: '/usr/bin/npx' if name == 'npx' else None,
        )
        self.assertEqual(command, ['/usr/bin/npx', '--yes', '@deepseek-ai/dsh', 'web'])

    def test_returns_none_without_a_launcher(self) -> None:
        self.assertIsNone(resolve_web_command({}, lookup=lambda _: None))


class GuiPathTests(unittest.TestCase):
    def test_prepends_user_bin_directories(self) -> None:
        path = gui_path({'HOME': '/home/dev', 'PATH': '/usr/bin'})
        self.assertEqual(path, '/home/dev/bin:/home/dev/.local/bin:/usr/bin')


if __name__ == '__main__':
    unittest.main()
