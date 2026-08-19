#!/usr/bin/env python3
"""DeepSeek Harness — native Linux shell over the local web UI.

GTK 4 + libadwaita + WebKitGTK 6 window, own launcher icon, server lifecycle
(auto-start when the health check fails), Ctrl+R reload, and Downloads-folder
attachment saving. Closing the window never stops the backend — sessions
outlive the shell. Build: scripts/linux-app/build.sh
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

import gi

gi.require_version('Adw', '1')
gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')

from gi.repository import Adw, Gio, GLib, Gtk, WebKit

from helpers import (
    APP_ID,
    APP_NAME,
    APP_URL,
    DOWNLOADS,
    POLL_SECONDS,
    SERVE_LOG,
    WEBKIT_CACHE,
    WEBKIT_DATA,
    gui_path,
    http_ok,
    uniquify_download,
)

HERE = Path(__file__).resolve().parent
BUNDLED_SERVE = HERE / 'dsh-serve'
USER_SERVE = Path.home() / 'bin' / 'dsh-serve'


def _serve_script() -> Path | None:
    for candidate in (USER_SERVE, BUNDLED_SERVE):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def start_server() -> None:
    """Spawn ``dsh-serve`` in a new session so the web server outlives this process."""
    env = os.environ.copy()
    env['PATH'] = gui_path(env)
    script = _serve_script()
    if script is None:
        print('deepseek-harness: dsh-serve is missing; install with scripts/linux-app/build.sh', file=sys.stderr)
        return
    subprocess.Popen(
        [str(script)],
        env=env,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )


def reveal_in_file_manager(path: Path) -> None:
    """Select ``path`` in the desktop file manager; fall back to opening its directory."""
    uri = path.resolve().as_uri()
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        proxy = Gio.DBusProxy.new_sync(
            bus,
            Gio.DBusProxyFlags.NONE,
            None,
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            None,
        )
        proxy.call_sync(
            'ShowItems',
            GLib.Variant('(ass)', ([uri], '')),
            Gio.DBusCallFlags.NONE,
            3000,
            None,
        )
        return
    except GLib.Error:
        Gio.AppInfo.launch_default_for_uri(path.parent.resolve().as_uri(), None)


def _is_attachment(decision: WebKit.ResponsePolicyDecision) -> bool:
    response = decision.get_response()
    headers = response.get_http_headers()
    if headers is None:
        return False
    try:
        disposition = headers.get_one('Content-Disposition') or ''
    except AttributeError:
        return False
    return 'attachment' in disposition.lower()


class MainWindow(Adw.ApplicationWindow):
    """Single WebKit window plus a loading/error stack while the server starts."""

    def __init__(self, app: Adw.Application) -> None:
        super().__init__(application=app, title=APP_NAME)
        self.set_default_size(1280, 840)
        self.set_size_request(780, 520)
        self._webview: WebKit.WebView | None = None
        self._downloads: dict[WebKit.Download, Path] = {}
        self._ready = False

        header = Adw.HeaderBar()
        reload_btn = Gtk.Button.new_from_icon_name('view-refresh-symbolic')
        reload_btn.set_tooltip_text('Reload Page')
        reload_btn.connect('clicked', lambda *_: self.reload())
        header.pack_start(reload_btn)

        self._stack = Gtk.Stack()
        self._stack.set_hexpand(True)
        self._stack.set_vexpand(True)

        loading = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        loading.set_halign(Gtk.Align.CENTER)
        loading.set_valign(Gtk.Align.CENTER)
        spinner = Gtk.Spinner()
        spinner.set_size_request(32, 32)
        spinner.start()
        loading_label = Gtk.Label(label='Starting DeepSeek Harness…')
        loading.append(spinner)
        loading.append(loading_label)
        self._stack.add_named(loading, 'loading')

        self._error = Adw.StatusPage(
            title='Web UI is not running',
            description='The shell waited 90 seconds for http://127.0.0.1:3080/. Check ~/.dsh/serve.log, then reload.',
        )
        retry = Gtk.Button(label='Retry')
        retry.add_css_class('suggested-action')
        retry.set_halign(Gtk.Align.CENTER)
        retry.connect('clicked', lambda *_: self.ensure_running())
        self._error.set_child(retry)
        self._stack.add_named(self._error, 'error')

        toolbar = Adw.ToolbarView()
        toolbar.add_top_bar(header)
        toolbar.set_content(self._stack)
        self.set_content(toolbar)
        self._install_actions(app)
        self.ensure_running()

    def _install_actions(self, app: Adw.Application) -> None:
        reload = Gio.SimpleAction.new('reload', None)
        reload.connect('activate', lambda *_: self.reload())
        self.add_action(reload)
        app.set_accels_for_action('win.reload', ['<Control>r', 'F5'])

        bypass = Gio.SimpleAction.new('reload-bypass', None)
        bypass.connect('activate', lambda *_: self.reload(bypass_cache=True))
        self.add_action(bypass)
        app.set_accels_for_action('win.reload-bypass', ['<Control><Shift>r'])

    def ensure_running(self) -> None:
        self._stack.set_visible_child_name('loading')
        self._poll(POLL_SECONDS, started=False)

    def _poll(self, remaining: int, started: bool) -> None:
        def work() -> None:
            ready = http_ok()
            GLib.idle_add(self._on_poll, ready, remaining, started)

        threading.Thread(target=work, daemon=True).start()

    def _on_poll(self, ready: bool, remaining: int, started: bool) -> bool:
        if ready:
            self._show_webview()
            return False
        if not started:
            start_server()
            GLib.timeout_add_seconds(1, lambda: self._poll(remaining - 1, True) or False)
            return False
        if remaining <= 0:
            self._show_error()
            return False
        GLib.timeout_add_seconds(1, lambda: self._poll(remaining - 1, True) or False)
        return False

    def _show_error(self) -> None:
        detail = 'The shell waited 90 seconds for http://127.0.0.1:3080/.'
        if SERVE_LOG.is_file():
            tail = SERVE_LOG.read_text(errors='replace').splitlines()[-8:]
            if tail:
                detail = detail + '\n\n' + '\n'.join(tail)
        self._error.set_description(detail)
        self._stack.set_visible_child_name('error')

    def _show_webview(self) -> None:
        if self._webview is None:
            self._webview = self._make_webview()
            self._stack.add_named(self._webview, 'web')
        elif self._webview.get_uri() in (None, '', 'about:blank'):
            self._webview.load_uri(APP_URL)
        self._ready = True
        self._stack.set_visible_child_name('web')

    def _make_webview(self) -> WebKit.WebView:
        WEBKIT_DATA.mkdir(parents=True, exist_ok=True)
        WEBKIT_CACHE.mkdir(parents=True, exist_ok=True)
        session = WebKit.NetworkSession.new(str(WEBKIT_DATA), str(WEBKIT_CACHE))
        session.set_persistent_credential_storage_enabled(True)
        session.get_cookie_manager().set_persistent_storage(
            str(WEBKIT_DATA / 'cookies.sqlite'),
            WebKit.CookiePersistentStorage.SQLITE,
        )
        session.connect('download-started', self._on_download_started)
        view = WebKit.WebView(network_session=session)
        view.set_hexpand(True)
        view.set_vexpand(True)
        settings = view.get_settings()
        settings.set_enable_developer_extras(True)
        view.connect('decide-policy', self._on_decide_policy)
        view.connect('create', self._on_create)
        view.load_uri(APP_URL)
        return view

    def _on_create(self, webview: WebKit.WebView, action: WebKit.NavigationAction) -> None:
        request = action.get_request()
        uri = request.get_uri() if request is not None else None
        if uri:
            webview.load_uri(uri)
        return None

    def _on_decide_policy(
        self,
        webview: WebKit.WebView,
        decision: WebKit.PolicyDecision,
        decision_type: WebKit.PolicyDecisionType,
    ) -> bool:
        if decision_type == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
            action = decision.get_navigation_action()
            request = action.get_request()
            uri = request.get_uri() if request is not None else None
            decision.ignore()
            if uri:
                webview.load_uri(uri)
            return True
        if decision_type == WebKit.PolicyDecisionType.RESPONSE:
            response_decision = decision
            if not response_decision.is_mime_type_supported() or _is_attachment(response_decision):
                decision.download()
                return True
            decision.use()
            return True
        decision.use()
        return True

    def _on_download_started(self, _session: WebKit.NetworkSession, download: WebKit.Download) -> None:
        download.connect('decide-destination', self._on_decide_destination)
        download.connect('finished', self._on_download_finished)
        download.connect('failed', self._on_download_failed)

    def _on_decide_destination(self, download: WebKit.Download, suggested_filename: str) -> bool:
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        destination = uniquify_download(DOWNLOADS, suggested_filename)
        self._downloads[download] = destination
        download.set_allow_overwrite(False)
        download.set_destination(destination.as_uri())
        return True

    def _on_download_finished(self, download: WebKit.Download) -> None:
        path = self._downloads.pop(download, None)
        if path is None:
            raw = download.get_destination()
            if raw:
                path = Path(GLib.filename_from_uri(raw)[0]) if raw.startswith('file:') else Path(raw)
        if path is not None and path.exists():
            reveal_in_file_manager(path)

    def _on_download_failed(self, download: WebKit.Download, error: GLib.Error) -> None:
        self._downloads.pop(download, None)
        dialog = Gtk.AlertDialog()
        dialog.set_message('Download failed')
        dialog.set_detail(error.message)
        dialog.show(self)

    def reload(self, bypass_cache: bool = False) -> None:
        if not self._ready or self._webview is None:
            self.ensure_running()
            return
        if bypass_cache:
            self._webview.reload_bypass_cache()
        else:
            self._webview.reload()


class Application(Adw.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        GLib.set_application_name(APP_NAME)
        self._window: MainWindow | None = None

    def do_startup(self) -> None:
        Adw.Application.do_startup(self)
        quit_action = Gio.SimpleAction.new('quit', None)
        quit_action.connect('activate', lambda *_: self.quit())
        self.add_action(quit_action)
        self.set_accels_for_action('app.quit', ['<Control>q'])

        about = Gio.SimpleAction.new('about', None)
        about.connect('activate', self._on_about)
        self.add_action(about)

    def do_activate(self) -> None:
        if self._window is None:
            self._window = MainWindow(self)
        self._window.present()

    def _on_about(self, *_args: object) -> None:
        dialog = Adw.AboutWindow(
            application_name=APP_NAME,
            application_icon=APP_ID,
            developer_name='DeepSeek AI',
            version='0.1.0-rc.7',
            website='https://github.com/deepseek-ai/deepseek-harness',
            comments='Native Linux shell over the local DeepSeek Harness Web UI.',
            transient_for=self._window,
        )
        dialog.present()


def main() -> int:
    os.environ['PATH'] = gui_path()
    # The webview loads only the loopback Web UI. WebKitGTK's bwrap sandbox
    # fails when unprivileged user namespaces are unavailable.
    os.environ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS'] = '1'
    if os.environ.get('DISPLAY') is None and os.environ.get('WAYLAND_DISPLAY') is None:
        print('deepseek-harness: no DISPLAY or WAYLAND_DISPLAY; a desktop session is required', file=sys.stderr)
        return 1
    GLib.set_prgname(APP_ID)
    GLib.set_application_name(APP_NAME)
    app = Application()
    return app.run(sys.argv)


if __name__ == '__main__':
    sys.exit(main())
