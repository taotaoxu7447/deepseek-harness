// Shared between the main shell (main.swift) and the remote-window helper
// (remote/main.swift): the new-context router that sends a dshRemoteLabel-
// carrying tunnel URL to the helper app instead of the browser, the page
// console mirror, the download delegate, the appearance-following Dock icon,
// and the standard menu builders. Both apps link this file; only a file
// literally named main.swift may carry top-level code, so this one holds none.

import Cocoa
import UniformTypeIdentifiers
import WebKit

// MARK: - Remote-window routing

/// The web app's "open in new window" gesture opens the tunnel URL in a new
/// browsing context with the device label riding `dshRemoteLabel`. Outside a
/// native shell that is a plain browser tab; here it routes to the bundled
/// helper app, which hosts the URL in its own window (own Dock icon, the
/// machine name as the window's subtitle).
enum RemoteOpener {
  static let labelParam = "dshRemoteLabel"
  static let helperBundleID = "com.deepseek.harness.desktop.remote"
  static let helperAppName = "DeepSeek Harness Remote"
  static let helperExecutableName = "DeepSeekHarnessRemote"
  static let openNotification = Notification.Name("com.deepseek.harness.desktop.remote.open")

  /// Whether the URL is a tunneled-UI open gesture (the label param marks it).
  static func isRemoteURL(_ url: URL) -> Bool {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.contains { $0.name == labelParam } ?? false
  }

  /// The device label the opener stamped on the URL, if any.
  static func label(of url: URL) -> String? {
    URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == labelParam }?.value
  }

  /// The helper executable this process can spawn: the main bundle's bundled
  /// helper, or — already inside the helper — this very executable. Nil for a
  /// deployment whose app bundle predates the helper.
  static func helperExecutable() -> URL? {
    if Bundle.main.bundleIdentifier == helperBundleID,
       let own = Bundle.main.executableURL {
      return own
    }
    let exec = Bundle.main.bundleURL.appendingPathComponent(
      "Contents/Helpers/\(helperAppName).app/Contents/MacOS/\(helperExecutableName)")
    return FileManager.default.fileExists(atPath: exec.path) ? exec : nil
  }

  /// Route a new-context URL: a tunneled-UI gesture spawns the helper app
  /// with the URL as its argument; anything else goes to the default browser.
  static func open(_ url: URL) {
    if isRemoteURL(url), let exec = helperExecutable() {
      let process = Process()
      process.executableURL = exec
      process.arguments = [url.absoluteString]
      try? process.run()
      return
    }
    NSWorkspace.shared.open(url)
  }
}

// MARK: - New-tab handoff

/// WKWebView silently drops `target=_blank` navigations without a UIDelegate.
/// Both apps hand them to RemoteOpener: tunnel URLs become helper windows,
/// everything else opens in the default browser.
final class UIDelegate: NSObject, WKUIDelegate {
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url {
      RemoteOpener.open(url)
    }
    return nil
  }
}

// MARK: - Page console mirror

/// Receives console.error/warn and window error events from the web page and
/// appends them to a small log file, so "works in the browser but not in the
/// app" failures leave evidence. The page-side hook is installed by a
/// WKUserScript when the window is made; the log is truncated at launch and
/// capped. Each app writes its own file so a helper and the main shell never
/// truncate each other's log.
final class ConsoleMirror: NSObject, WKScriptMessageHandler {
  /// The page hook: wrap console.error/warn and forward window errors.
  static let userScript = """
    (() => {
      if (window.__dshConsoleMirror) return
      window.__dshConsoleMirror = true
      const post = (level, text) => {
        try { webkit.messageHandlers.dshConsole.postMessage(level + ': ' + text.slice(0, 2000)) } catch (_) {}
      }
      const render = (args) => args.map((a) => {
        try { return typeof a === 'string' ? a : JSON.stringify(a) } catch (_) { return String(a) }
      }).join(' ')
      for (const level of ['error', 'warn']) {
        const original = console[level].bind(console)
        console[level] = (...args) => { post(level, render(args)); original(...args) }
      }
      window.addEventListener('error', (e) => post('window-error', `${e.message} @ ${e.filename || ''}:${e.lineno || ''}`))
      window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason
        post('unhandled-rejection', String(reason && (reason.stack || reason.message) || reason))
      })
    })()
    """

  private let logURL: URL
  private let queue = DispatchQueue(label: "dsh.console-mirror")
  /// File URL derived from the log name; the native drop bridge appends its
  /// own instrumentation here so one file holds both sides of a drop.
  private static var files: [String: ConsoleMirror] = [:]

  /// Register this mirror under its log name so native-side instrumentation
  /// (the drop bridge) can append to the same file. Called by the app at
  /// startup; the map never shrinks because each app run truncates its log.
  static func publish(_ mirror: ConsoleMirror, as logName: String) {
    files[logName] = mirror
  }

  /// Append one native-side line to the log registered under `logName`.
  /// Silent no-op before the owning app publishes its mirror.
  static func log(_ line: String, to logName: String) {
    files[logName]?.append("native: \(line)")
  }

  init(logName: String) {
    logURL = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Logs/\(logName)")
    super.init()
    // Fresh log per app run; stale field reports only confuse.
    queue.async { [logURL] in
      try? FileManager.default.removeItem(at: logURL)
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let line = message.body as? String else { return }
    append(line)
  }

  /// Serialize one line into the log file, with the size cap applied.
  fileprivate func append(_ line: String) {
    queue.async { [logURL] in
      let stamp = ISO8601DateFormatter().string(from: Date())
      let data = Data("\(stamp) \(line)\n".utf8)
      if let handle = try? FileHandle(forWritingTo: logURL) {
        defer { try? handle.close() }
        // Cap at ~1MB: drop and restart; only fresh failures matter.
        if ((try? handle.seekToEnd()) ?? 0) > 1_000_000 {
          try? handle.close()
          try? FileManager.default.removeItem(at: logURL)
          try? data.write(to: logURL)
          return
        }
        try? handle.write(contentsOf: data)
      } else {
        try? data.write(to: logURL)
      }
    }
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

// MARK: - Composer drop bridge

/// Transparent overlay that owns Finder file/folder drags for the composer.
/// A page-side drop only sees File objects — never absolute paths — so a
/// dropped folder is useless there; this overlay intercepts `.fileURL` drags
/// natively, keeps the absolute paths, and hands the composer a payload over
/// `window.__dshNativeDrop`: folders and non-image files become `@` path
/// mentions, image files ride along as bytes (base64) so the image draft
/// flow behaves exactly as a page-level drop did. `hitTest` returning nil
/// keeps every click on the web view; AppKit resolves drag destinations by
/// geometry and registration, not by hitTest.
final class ComposerDropBridgeView: NSView {
  /// Images larger than this are not read into the bridge payload.
  private static let maxImageBytes = 32 * 1024 * 1024
  /// At most this many images ride one drop; the composer's own limits stay
  /// authoritative downstream.
  private static let maxImages = 16

  private weak var webView: WKWebView?

  /// Keeps the class alive: its ObjC registration carries no user reachable
  /// from Swift roots, and the container's subview array is invisible to the
  /// optimizer, so a whole-module `-O` build dead-strips the entire class —
  /// the drop bridge silently vanishes from the installed binary. The flag is
  /// read in `hitTest` below so the store itself cannot be eliminated.
  private var keepAlive: ComposerDropBridgeView?

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: webView.frame)
    keepAlive = self
    registerForDraggedTypes([.fileURL])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func hitTest(_ point: NSPoint) -> NSView? {
    _ = keepAlive
    return nil
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }
  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    let urls = sender.draggingPasteboard.readObjects(
      forClasses: [NSURL.self],
      options: [.urlReadingFileURLsOnly: true],
    ) as? [URL] ?? []
    guard !urls.isEmpty, let webView else {
      Self.log("no usable URLs (\(urls.count) read) or no web view")
      return false
    }
    deliver(urls, to: webView)
    return true
  }

  /// Log file for bridge diagnostics: NSLog output is unreadable in this
  /// deployment (the unified-log store refuses reads), so the bridge appends
  /// to its own file — ~/Library/Logs/DeepSeekHarness-drop.log — next to the
  /// page console mirror. Only fresh failures matter; no rotation needed at
  /// this write volume.
  private static let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/DeepSeekHarness-drop.log")

  /// Append one timestamped line to the drop log.
  private static func log(_ line: String) {
    let stamp = ISO8601DateFormatter().string(from: Date())
    let data = Data("\(stamp) \(line)\n".utf8)
    if let handle = try? FileHandle(forWritingTo: logURL) {
      defer { try? handle.close() }
      _ = try? handle.seekToEnd()
      try? handle.write(contentsOf: data)
    } else {
      try? data.write(to: logURL)
    }
  }

  /// The owning app's console-mirror log name, set at window creation so
  /// native-side drop instrumentation lands in the same file the page uses.
  static var logName = "DeepSeekHarness-web.log"

  /// Split the dropped URLs into mention entries (directories, non-image
  /// files, unreadable items) and image entries (bytes inlined), then call
  /// the page-side receiver when it is mounted.
  private func deliver(_ urls: [URL], to webView: WKWebView) {
    var mentions: [[String: Any]] = []
    var images: [[String: Any]] = []
    for url in urls {
      let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
      if values?.isDirectory == true {
        mentions.append(["path": url.path, "directory": true])
        continue
      }
      let uti = UTType(filenameExtension: url.pathExtension)
      let isImage = uti?.conforms(to: .image) ?? false
      let size = values?.fileSize ?? 0
      if isImage, images.count < Self.maxImages, size <= Self.maxImageBytes,
         let data = try? Data(contentsOf: url) {
        images.append([
          "name": url.lastPathComponent,
          "type": uti?.preferredMIMEType ?? "application/octet-stream",
          "data": data.base64EncodedString(),
        ])
        continue
      }
      mentions.append(["path": url.path, "directory": false])
    }
    let payload: [String: Any] = ["mentions": mentions, "images": images]
    guard let json = try? JSONSerialization.data(withJSONObject: payload),
          let js = String(data: json, encoding: .utf8) else {
      Self.log("payload JSON encoding failed")
      return
    }
    Self.log("\(urls.count) item(s) -> \(mentions.count) mention(s), \(images.count) image(s)")
    webView.evaluateJavaScript("window.__dshNativeDrop ? (window.__dshNativeDrop(\(js)), true) : false") { result, error in
      if let error {
        Self.log("page receiver failed: \(error.localizedDescription)")
      } else if let delivered = result as? Bool {
        if !delivered {
          Self.log("page receiver not mounted (no composer listening)")
        }
      } else {
        Self.log("receiver check returned \(type(of: result)): \(String(describing: result))")
      }
    }
  }
}

/// The window content view: the web view plus the drop-bridge overlay on top,
/// both pinned to the container's frame by autoresizing.
func composerDropContainer(webView: WKWebView, frame: NSRect) -> NSView {
  let container = NSView(frame: frame)
  webView.autoresizingMask = [.width, .height]
  container.addSubview(webView)
  let overlay = ComposerDropBridgeView(webView: webView)
  overlay.autoresizingMask = [.width, .height]
  container.addSubview(overlay)
  return container
}

// MARK: - Shared chrome

/// A WKWebView preconfigured with the console mirror and both delegates.
func makeWebView(consoleMirror: ConsoleMirror, navigationDelegate: NavigationDelegate,
                 uiDelegate: UIDelegate, frame: NSRect) -> WKWebView {
  let configuration = WKWebViewConfiguration()
  configuration.userContentController.add(consoleMirror, name: "dshConsole")
  configuration.userContentController.addUserScript(
    WKUserScript(source: ConsoleMirror.userScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
  )
  let view = WKWebView(frame: frame, configuration: configuration)
  view.navigationDelegate = navigationDelegate
  view.uiDelegate = uiDelegate
  return view
}

/// Follow the system appearance onto the Dock icon (both icon PNGs ship in
/// each bundle's Resources).
func applyAppearanceIcon() {
  let match = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
  let resourceName = match == .darkAqua ? "AppIconDark" : "AppIconLight"
  guard let iconURL = Bundle.main.url(forResource: resourceName, withExtension: "png"),
        let icon = NSImage(contentsOf: iconURL) else {
    return
  }
  NSApp.applicationIconImage = icon
}

/// The standard Edit menu so copy/paste shortcuts work inside the web view.
func makeEditMenu() -> NSMenuItem {
  let editSub = NSMenu(title: "Edit")
  editSub.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
  editSub.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
  editSub.addItem(NSMenuItem.separator())
  editSub.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
  editSub.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
  editSub.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
  editSub.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")
  let item = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
  item.submenu = editSub
  return item
}

/// The application menu with About and Quit.
func makeAppMenu(appName: String) -> NSMenuItem {
  let appSub = NSMenu(title: appName)
  appSub.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
  appSub.addItem(NSMenuItem.separator())
  appSub.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
  let item = NSMenuItem(title: appName, action: nil, keyEquivalent: "")
  item.submenu = appSub
  return item
}
