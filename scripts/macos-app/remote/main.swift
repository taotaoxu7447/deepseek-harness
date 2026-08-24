// DeepSeek Harness Remote — the helper app hosting one tunneled remote web UI
// in its own window. Spawned by the main shell (or itself) through
// RemoteOpener with the tunnel URL as argv[1]; the device label riding the
// URL's dshRemoteLabel parameter becomes the window's subtitle, so the Dock
// icon and titlebar both say which machine this window belongs to. A second
// spawn forwards its URL to the running instance over a distributed
// notification and exits, keeping one process — one Dock icon — for every
// remote window. Closing the window quits the helper.
// Build: scripts/macos-app/build.sh (linked with ../shared.swift)

import Cocoa
import WebKit

final class RemoteAppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var webView: WKWebView?
  var appearanceObservation: NSKeyValueObservation?
  let navigationDelegate = NavigationDelegate()
  let uiDelegate = UIDelegate()
  let consoleMirror = ConsoleMirror(logName: "DeepSeekHarnessRemote-web.log")

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard let raw = CommandLine.arguments.dropFirst().first, let url = URL(string: raw) else {
      // The helper exists only to host a remote URL; a bare launch is a no-op.
      NSApp.terminate(nil)
      return
    }
    // Single instance: a second spawn hands its URL to the running instance…
    let siblings = NSRunningApplication
      .runningApplications(withBundleIdentifier: RemoteOpener.helperBundleID)
      .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
    if !siblings.isEmpty {
      DistributedNotificationCenter.default().postNotificationName(
        RemoteOpener.openNotification, object: nil,
        userInfo: ["url": url.absoluteString], deliverImmediately: true
      )
      NSApp.terminate(nil)
      return
    }
    // …which opens it in a fresh window state and raises.
    DistributedNotificationCenter.default().addObserver(
      forName: RemoteOpener.openNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let rawURL = note.userInfo?["url"] as? String, let next = URL(string: rawURL) else { return }
      self?.open(next)
    }
    makeMenu()
    appearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.initial, .new]) { _, _ in
      DispatchQueue.main.async { applyAppearanceIcon() }
    }
    ConsoleMirror.publish(consoleMirror, as: "DeepSeekHarnessRemote-web.log")
    ComposerDropBridgeView.logName = "DeepSeekHarnessRemote-web.log"
    open(url)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    // The Dock icon exists for the window it hosts; closing the window ends both.
    true
  }

  /// Load a tunnel URL, creating the window on first use and raising it after.
  private func open(_ url: URL) {
    if window == nil {
      makeWindow()
    }
    applyTitle(for: url)
    webView?.load(URLRequest(url: url))
    window?.makeKeyAndOrderFront(self)
    NSApp.activate(ignoringOtherApps: true)
  }

  /// Title stays the app name; the machine name rides as the subtitle. A URL
  /// without the label param names its host:port instead.
  private func applyTitle(for url: URL) {
    guard let window else { return }
    window.title = "DeepSeek Harness"
    window.subtitle = RemoteOpener.label(of: url)
      ?? "\(url.host ?? "?"):\(url.port ?? (url.scheme == "https" ? 443 : 80))"
  }

  private func makeWindow() {
    let view = makeWebView(
      consoleMirror: consoleMirror, navigationDelegate: navigationDelegate,
      uiDelegate: uiDelegate, frame: NSRect(x: 0, y: 0, width: 1280, height: 840)
    )
    let window = NSWindow(
      contentRect: view.frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false,
    )
    window.contentMinSize = NSSize(width: 780, height: 520)
    window.setFrameAutosaveName("DSHRemoteWindow")
    window.contentView = composerDropContainer(webView: view, frame: view.frame)
    window.center()
    self.window = window
    self.webView = view
  }

  @objc private func reload(_ sender: Any?) {
    webView?.reload()
  }

  @objc private func closeWindow(_ sender: Any?) {
    window?.close()
  }

  private func makeMenu() {
    let main = NSMenu()
    main.addItem(makeAppMenu(appName: ProcessInfo.processInfo.processName))
    main.addItem(makeEditMenu())
    let viewSub = NSMenu(title: "View")
    viewSub.addItem(withTitle: "Reload Page", action: #selector(reload(_:)), keyEquivalent: "r")
    main.addItem(withTitle: "View", action: nil, keyEquivalent: "").submenu = viewSub
    let windowSub = NSMenu(title: "Window")
    windowSub.addItem(withTitle: "Close", action: #selector(closeWindow(_:)), keyEquivalent: "w")
    main.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = windowSub
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = RemoteAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
