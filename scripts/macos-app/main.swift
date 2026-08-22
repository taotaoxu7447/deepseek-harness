// DeepSeek Harness — native macOS shell over the local web UI.
// Own Dock icon, WKWebView window, server lifecycle (auto-start when the
// health check fails, restart offer when the server predates the newest
// on-disk build or the health endpoint itself), Dock-click reopen, ⌘R reload,
// ⌘0 back to the local Host after the window navigated to a remote device's
// tunneled UI, a window title that names the host being viewed, target=_blank
// links routed through RemoteOpener (a dshRemoteLabel-carrying tunnel URL
// spawns the bundled helper app as its own window/Dock icon; anything else
// goes to the default browser), page console errors mirrored to
// ~/Library/Logs/DeepSeekHarness-web.log for field diagnosis, and the
// standard Edit menu so copy/paste shortcuts work inside the web view.
// Build: scripts/macos-app/build.sh

import Cocoa
import WebKit

let appURL = URL(string: "http://127.0.0.1:3080/")!
let healthURL = URL(string: "/__dsh_health", relativeTo: appURL)!.absoluteURL
let serverCommand = "/bin/zsh -lc '$HOME/bin/dsh-serve'"

/// The web-app bundle's supervisor payload at /__dsh_health: process start,
/// last complete build, and the derived staleness verdict (epoch milliseconds).
struct ServerHealth: Decodable {
  let startedAt: Double
  let builtAt: Double?
  let stale: Bool
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var webView: WKWebView?
  var pollTimer: Timer?
  var appearanceObservation: NSKeyValueObservation?
  var urlObservation: NSKeyValueObservation?
  /// The build stamp whose restart offer the user already declined; a newer build re-prompts.
  var declinedBuild: Double?
  /// The user already declined a restart offer for a legacy (pre-endpoint) server this run.
  var declinedLegacy = false
  /// A modal restart offer is already up; the launch probe and the reopen probe can race it.
  var promptShowing = false
  let navigationDelegate = NavigationDelegate()
  let uiDelegate = UIDelegate()
  let consoleMirror = ConsoleMirror(logName: "DeepSeekHarness-web.log")

  func applicationDidFinishLaunching(_ notification: Notification) {
    makeMenu()
    observeAppearance()
    ConsoleMirror.publish(consoleMirror, as: "DeepSeekHarness-web.log")
    Server.ensureRunning { [weak self] state in
      self?.presentOrPrompt(state)
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    if window == nil {
      makeWindow()
    }
    window?.makeKeyAndOrderFront(self)
    // A rebuild plus a Dock click is the "where is my new feature?" moment —
    // re-check freshness on every reopen, not just at launch.
    Server.probe { [weak self] state in
      DispatchQueue.main.async {
        guard let self, !self.promptShowing else { return }
        switch state {
        case .up(let health) where health.stale && health.builtAt != self.declinedBuild:
          self.promptRestart(health)
        case .legacy where !self.declinedLegacy:
          self.promptRestart(nil)
        default:
          break
        }
      }
    }
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    // Keep the Dock presence; ⌘Q is the explicit quit, and quitting never
    // stops the backend — sessions outlive the window.
    false
  }

  /// Show the window, or offer the restart first when the server is stale:
  /// a current server whose on-disk build postdates it, or a legacy one that
  /// predates the health endpoint entirely. Declines snooze per build stamp.
  private func presentOrPrompt(_ state: Server.ProbeState) {
    switch state {
    case .up(let health) where health.stale && health.builtAt != declinedBuild:
      promptRestart(health)
    case .legacy where !declinedLegacy:
      promptRestart(nil)
    default:
      showWindow()
    }
  }

  /// Modal restart offer; "Later" snoozes until the next build (or this run,
  /// for a legacy server whose build stamp is unknowable).
  private func promptRestart(_ health: ServerHealth?) {
    promptShowing = true
    defer { promptShowing = false }
    let alert = NSAlert()
    alert.messageText = "New build available"
    if let health {
      let started = Date(timeIntervalSince1970: health.startedAt / 1000).formatted(date: .omitted, time: .shortened)
      let built = Date(timeIntervalSince1970: (health.builtAt ?? 0) / 1000).formatted(date: .omitted, time: .shortened)
      alert.informativeText = "The running server started at \(started), but a newer build finished at \(built). "
        + "Restart the server to load new features. Running tasks are interrupted; session history is preserved."
    } else {
      alert.informativeText = "The running server is too old to report its build, so it cannot be serving today's features. "
        + "Restart it to load the latest build. Running tasks are interrupted; session history is preserved."
    }
    alert.addButton(withTitle: "Restart Server")
    alert.addButton(withTitle: "Later")
    guard alert.runModal() == .alertFirstButtonReturn else {
      if let health { declinedBuild = health.builtAt } else { declinedLegacy = true }
      showWindow()
      return
    }
    Server.restart { [weak self] restarted in
      guard let self else { return }
      if restarted {
        // The old page — local or tunneled-remote — belongs to the dead server.
        self.webView?.load(URLRequest(url: appURL))
        self.showWindow()
        return
      }
      let failure = NSAlert()
      failure.messageText = "Server could not be restarted"
      failure.informativeText = "The old process still holds the port, or the new one failed to start. Kill any leftover dsh server (Activity Monitor or `kill`), then relaunch the app."
      failure.runModal()
      self.showWindow()
    }
  }

  private func showWindow() {
    if window == nil {
      makeWindow()
    } else if let view = webView, view.url == nil {
      view.load(URLRequest(url: appURL))
    }
    window?.makeKeyAndOrderFront(self)
  }

  private func makeWindow() {
    let view = makeWebView(
      consoleMirror: consoleMirror, navigationDelegate: navigationDelegate,
      uiDelegate: uiDelegate, frame: NSRect(x: 0, y: 0, width: 1280, height: 840)
    )
    view.load(URLRequest(url: appURL))
    let window = NSWindow(
      contentRect: view.frame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false,
    )
    window.title = "DeepSeek Harness"
    window.contentMinSize = NSSize(width: 780, height: 520)
    window.setFrameAutosaveName("DSHMainWindow")
    window.contentView = composerDropContainer(webView: view, frame: view.frame)
    window.center()
    window.makeKeyAndOrderFront(self)
    self.window = window
    self.webView = view
    urlObservation = view.observe(\.url, options: [.initial, .new]) { [weak self] view, _ in
      DispatchQueue.main.async {
        self?.updateTitle(for: view.url)
      }
    }
  }

  /// The local Host keeps the bare app name; any other origin — a remote
  /// device's tunneled UI on another loopback port — names the host:port.
  private func updateTitle(for url: URL?) {
    guard let window else { return }
    let localPort = appURL.port ?? 80
    guard let url, let host = url.host,
          !((host == "127.0.0.1" || host == "localhost") && (url.port ?? 80) == localPort) else {
      window.title = "DeepSeek Harness"
      return
    }
    window.title = "DeepSeek Harness — \(host):\(url.port ?? (url.scheme == "https" ? 443 : 80))"
  }

  @objc private func reload(_ sender: Any?) {
    webView?.reload()
  }

  @objc private func showLocal(_ sender: Any?) {
    webView?.load(URLRequest(url: appURL))
  }

  private func makeMenu() {
    let main = NSMenu()
    let appName = ProcessInfo.processInfo.processName
    main.addItem(makeAppMenu(appName: appName))
    main.addItem(makeEditMenu())

    let viewSub = NSMenu(title: "View")
    viewSub.addItem(withTitle: "Reload Page", action: #selector(reload(_:)), keyEquivalent: "r")
    viewSub.addItem(withTitle: "Show Local", action: #selector(showLocal(_:)), keyEquivalent: "0")
    main.addItem(withTitle: "View", action: nil, keyEquivalent: "").submenu = viewSub

    NSApp.mainMenu = main
  }

  private func observeAppearance() {
    appearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.initial, .new]) { _, _ in
      DispatchQueue.main.async {
        applyAppearanceIcon()
      }
    }
  }

}

enum Server {
  /// What answers on the app port: nothing; a foreign process (left strictly
  /// alone); a legacy dsh that predates the health endpoint — fingerprinted
  /// by the injected boot marker so it can still be offered a restart; or a
  /// current server carrying its health payload.
  enum ProbeState {
    case down
    case foreign
    case legacy
    case up(ServerHealth)
  }

  /// Health probes must never reuse a cached response: staleness is the point.
  private static let session = URLSession(configuration: .ephemeral)

  static func isRunning(_ completion: @escaping (Bool) -> Void) {
    let task = session.dataTask(with: appURL) { _, response, _ in
      completion((response as? HTTPURLResponse)?.statusCode == 200)
    }
    task.resume()
  }

  static func probe(_ completion: @escaping (ProbeState) -> Void) {
    let task = session.dataTask(with: healthURL) { data, response, _ in
      if let data, (response as? HTTPURLResponse)?.statusCode == 200,
         let health = try? JSONDecoder().decode(ServerHealth.self, from: data) {
        completion(.up(health))
        return
      }
      // A pre-endpoint dsh's SPA fallback answers this path with index.html:
      // JSON parsing is the discriminator, and the root page's boot marker
      // tells that legacy dsh apart from a foreign process squatting here.
      fingerprint(completion)
    }
    task.resume()
  }

  /// Classify the root page: a 200 carrying `__DSH_BOOT__` is a legacy dsh.
  private static func fingerprint(_ completion: @escaping (ProbeState) -> Void) {
    let task = session.dataTask(with: appURL) { data, response, _ in
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        completion(.down)
        return
      }
      let html = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      completion(html.contains("__DSH_BOOT__") ? .legacy : .foreign)
    }
    task.resume()
  }

  /// Guarantee an answering server, then hand the probe verdict to the caller
  /// on the main queue.
  static func ensureRunning(then: @escaping (ProbeState) -> Void) {
    probe { state in
      switch state {
      case .down:
        spawn()
        pollUntilReady(remaining: 90, then: then)
      default:
        DispatchQueue.main.async { then(state) }
      }
    }
  }

  /// Stop the stale listener (SIGTERM first so cordis teardown closes tunnels
  /// and sessions cleanly; SIGKILL only when the grace poll expires), wait for
  /// the port to close, then spawn a fresh server. Reports whether a fresh
  /// server answers, on the main queue.
  static func restart(then: @escaping (Bool) -> Void) {
    killListener(force: false)
    pollUntilGone(remaining: 15) { gone in
      if gone {
        spawnAndAwait(then: then)
        return
      }
      killListener(force: true)
      pollUntilGone(remaining: 5) { forced in
        if forced { spawnAndAwait(then: then) }
        else { DispatchQueue.main.async { then(false) } }
      }
    }
  }

  private static func spawn() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-c", serverCommand]
    try? process.run()
  }

  private static func spawnAndAwait(then: @escaping (Bool) -> Void) {
    spawn()
    pollUntilAlive(remaining: 90, then: then)
  }

  private static func pollUntilAlive(remaining: Int, then: @escaping (Bool) -> Void) {
    guard remaining > 0 else {
      DispatchQueue.main.async { then(false) }
      return
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
      isRunning { running in
        if running { DispatchQueue.main.async { then(true) } }
        else { pollUntilAlive(remaining: remaining - 1, then: then) }
      }
    }
  }

  private static func killListener(force: Bool) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-c", "/usr/sbin/lsof -ti tcp:\(appURL.port ?? 80) -sTCP:LISTEN | xargs kill \(force ? "-9" : "-TERM")"]
    try? process.run()
  }

  private static func pollUntilReady(remaining: Int, then: @escaping (ProbeState) -> Void) {
    guard remaining > 0 else {
      // A spawn timeout still shows the window: the page fails visibly and ⌘R retries.
      DispatchQueue.main.async { then(.down) }
      return
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
      probe { state in
        if case .down = state {
          pollUntilReady(remaining: remaining - 1, then: then)
        } else {
          DispatchQueue.main.async { then(state) }
        }
      }
    }
  }

  private static func pollUntilGone(remaining: Int, then: @escaping (Bool) -> Void) {
    guard remaining > 0 else {
      DispatchQueue.main.async { then(false) }
      return
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
      isRunning { running in
        if running { pollUntilGone(remaining: remaining - 1, then: then) }
        else { DispatchQueue.main.async { then(true) } }
      }
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
