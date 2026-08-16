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

  func applicationDidFinishLaunching(_ notification: Notification) {
    makeMenu()
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

}

enum Server {
  static func isRunning(_ completion: @escaping (Bool) -> Void) {
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
