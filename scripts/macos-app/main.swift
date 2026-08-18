// DeepSeek Harness — native macOS shell over the local web UI.
// Own Dock icon, WKWebView window, server lifecycle (auto-start when the
// health check fails), Dock-click reopen, ⌘R reload, and the standard Edit
// menu so copy/paste shortcuts work inside the web view.
// Build: scripts/macos-app/build.sh

import Cocoa
import WebKit

let appURL = URL(string: "http://127.0.0.1:3080/")!
let serverCommand = "/bin/zsh -lc '$HOME/bin/dsh-serve'"

final class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var webView: WKWebView?
  var pollTimer: Timer?
  var appearanceObservation: NSKeyValueObservation?
  let navigationDelegate = NavigationDelegate()

  func applicationDidFinishLaunching(_ notification: Notification) {
    makeMenu()
    observeAppearance()
    Server.ensureRunning { [weak self] in
      self?.showWindow()
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    if window == nil {
      makeWindow()
    }
    window?.makeKeyAndOrderFront(self)
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    // Keep the Dock presence; ⌘Q is the explicit quit, and quitting never
    // stops the backend — sessions outlive the window.
    false
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
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 840))
    view.navigationDelegate = navigationDelegate
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
    window.contentView = view
    window.center()
    window.makeKeyAndOrderFront(self)
    self.window = window
    self.webView = view
  }

  @objc private func reload(_ sender: Any?) {
    webView?.reload()
  }

  private func makeMenu() {
    let main = NSMenu()
    let appName = ProcessInfo.processInfo.processName
    let appSub = NSMenu(title: appName)
    appSub.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appSub.addItem(NSMenuItem.separator())
    appSub.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    main.addItem(withTitle: appName, action: nil, keyEquivalent: "").submenu = appSub

    let editSub = NSMenu(title: "Edit")
    editSub.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    editSub.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    editSub.addItem(NSMenuItem.separator())
    editSub.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
    editSub.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
    editSub.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
    editSub.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")
    main.addItem(withTitle: "Edit", action: nil, keyEquivalent: "").submenu = editSub

    let viewSub = NSMenu(title: "View")
    viewSub.addItem(withTitle: "Reload Page", action: #selector(reload(_:)), keyEquivalent: "r")
    main.addItem(withTitle: "View", action: nil, keyEquivalent: "").submenu = viewSub

    NSApp.mainMenu = main
  }

  private func observeAppearance() {
    appearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.initial, .new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        self?.updateApplicationIcon()
      }
    }
  }

  private func updateApplicationIcon() {
    let match = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
    let resourceName = match == .darkAqua ? "AppIconDark" : "AppIconLight"
    guard let iconURL = Bundle.main.url(forResource: resourceName, withExtension: "png"),
          let icon = NSImage(contentsOf: iconURL) else {
      return
    }
    NSApp.applicationIconImage = icon
  }

}

// MARK: - Downloads

/// WKWebView never downloads on its own: an `<a download>` click or an
/// attachment response is silently dropped unless the navigation delegate
/// converts it into a WKDownload and the download delegate names a
/// destination. Routes every unrenderable response (the session-log ZIP
/// carries `Content-Disposition: attachment`) to a uniquified file in
/// ~/Downloads and reveals it in Finder when it lands.
final class NavigationDelegate: NSObject, WKNavigationDelegate, WKDownloadDelegate {
  /// Destination chosen for the in-flight download, revealed on finish.
  private var destination: URL?

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    guard let directory = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else {
      completionHandler(nil)
      return
    }
    let name = (suggestedFilename as NSString).deletingPathExtension
    let ext = (suggestedFilename as NSString).pathExtension
    var suffix = 0
    var candidate: URL
    repeat {
      suffix += 1
      let fileName = suffix == 1 ? suggestedFilename : ext.isEmpty ? "\(name)-\(suffix)" : "\(name)-\(suffix).\(ext)"
      candidate = directory.appendingPathComponent(fileName)
    } while FileManager.default.fileExists(atPath: candidate.path)
    destination = candidate
    completionHandler(candidate)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let url = destination else { return }
    destination = nil
    NSWorkspace.shared.activateFileViewerSelecting([url])
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    destination = nil
    let alert = NSAlert()
    alert.messageText = "Download failed"
    alert.informativeText = error.localizedDescription
    alert.runModal()
  }
}

enum Server {  static func isRunning(_ completion: @escaping (Bool) -> Void) {
    let task = URLSession.shared.dataTask(with: appURL) { _, response, _ in
      completion((response as? HTTPURLResponse)?.statusCode == 200)
    }
    task.resume()
  }

  static func ensureRunning(then: @escaping () -> Void) {
    isRunning { running in
      if running {
        DispatchQueue.main.async(execute: then)
        return
      }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/zsh")
      process.arguments = ["-c", serverCommand]
      try? process.run()
      pollUntilReady(remaining: 90, then: then)
    }
  }

  private static func pollUntilReady(remaining: Int, then: @escaping () -> Void) {
    guard remaining > 0 else {
      DispatchQueue.main.async(execute: then)
      return
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
      isRunning { running in
        if running {
          DispatchQueue.main.async(execute: then)
        } else {
          pollUntilReady(remaining: remaining - 1, then: then)
        }
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
