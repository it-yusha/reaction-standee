import AppKit
import WebKit

final class DragRegionView: NSView {
  override var mouseDownCanMoveWindow: Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    self
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  private let recordURLString: String
  private let settingsURL = URL(string: "http://127.0.0.1:5173/settings")!
  private var window: NSWindow?
  private var webView: WKWebView?
  private var statusLabel: NSTextField?

  override init() {
    recordURLString = CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:5173/record?camera=low&inferFps=30"
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let url = URL(string: recordURLString) ?? URL(string: "http://127.0.0.1:5173/record?camera=low&inferFps=30")!

    NSApp.setActivationPolicy(.regular)
    buildMenu()

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.applicationNameForUserAgent = "ReactionStandeeWKPreview"

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = false
    webView.customUserAgent = "ReactionStandeeWKPreview"
    webView.setValue(false, forKey: "drawsBackground")
    webView.translatesAutoresizingMaskIntoConstraints = false

    let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 900)
    let preferredHeight = min(screenFrame.height - 80, 960)
    let preferredWidth = preferredHeight * 9 / 16
    let windowFrame = NSRect(
      x: screenFrame.midX - preferredWidth / 2,
      y: screenFrame.midY - preferredHeight / 2,
      width: preferredWidth,
      height: preferredHeight
    )

    let window = NSWindow(
      contentRect: windowFrame,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.title = "Reaction Standee Record"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.isMovableByWindowBackground = true
    window.contentAspectRatio = NSSize(width: 9, height: 16)
    window.backgroundColor = NSColor.black

    let contentView = NSView()
    contentView.wantsLayer = true
    contentView.layer?.backgroundColor = NSColor.black.cgColor
    contentView.addSubview(webView)

    let statusLabel = NSTextField(labelWithString: "ローカルサーバーを起動しています...")
    statusLabel.textColor = NSColor.white
    statusLabel.font = NSFont.systemFont(ofSize: 16, weight: .medium)
    statusLabel.alignment = .center
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(statusLabel)

    let dragRegion = DragRegionView()
    dragRegion.translatesAutoresizingMaskIntoConstraints = false
    dragRegion.wantsLayer = true
    dragRegion.layer?.backgroundColor = NSColor.clear.cgColor
    contentView.addSubview(dragRegion)

    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      webView.topAnchor.constraint(equalTo: contentView.topAnchor),
      webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
      statusLabel.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      dragRegion.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      dragRegion.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      dragRegion.topAnchor.constraint(equalTo: contentView.topAnchor),
      dragRegion.heightAnchor.constraint(equalToConstant: 64),
    ])

    window.contentView = contentView
    window.makeKeyAndOrderFront(nil)

    NSApp.activate(ignoringOtherApps: true)

    self.window = window
    self.webView = webView
    self.statusLabel = statusLabel
    ensureServerAndLoad(url)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  @objc private func reloadRecordWindow() {
    webView?.reload()
  }

  @objc private func reopenRecordWindow() {
    guard let url = URL(string: recordURLString) else {
      reloadRecordWindow()
      return
    }
    loadRecordURL(url)
  }

  @objc private func openSettingsInSafari() {
    NSWorkspace.shared.open(settingsURL)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showLoadError(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    showLoadError(error)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    statusLabel?.isHidden = true
  }

  private func showLoadError(_ error: Error) {
    let alert = NSAlert()
    alert.messageText = "Reaction Standeeを読み込めませんでした"
    alert.informativeText = "\(error.localizedDescription)\n\n自動起動できなかった場合は、ログを確認してください。\n~/Library/Logs/ReactionStandee.log"
    alert.alertStyle = .warning
    alert.runModal()
  }

  private func ensureServerAndLoad(_ url: URL) {
    checkServer { [weak self] ready in
      guard let self else { return }
      if ready {
        self.loadRecordURL(url)
        return
      }

      self.startLocalServer()
      self.waitForServer(url, attempt: 0)
    }
  }

  private func checkServer(completion: @escaping (Bool) -> Void) {
    var request = URLRequest(url: settingsURL)
    request.timeoutInterval = 1
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let ready = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async {
        completion(ready)
      }
    }.resume()
  }

  private func startLocalServer() {
    guard let scriptURL = Bundle.main.url(forResource: "start-server", withExtension: "sh") else {
      showServerStartError("起動スクリプトが見つかりません。")
      return
    }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = [scriptURL.path]
    do {
      try process.run()
    } catch {
      showServerStartError(error.localizedDescription)
    }
  }

  private func waitForServer(_ url: URL, attempt: Int) {
    guard attempt < 80 else {
      showServerStartError("20秒以内にローカルサーバーを起動できませんでした。")
      return
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      self?.checkServer { ready in
        guard let self else { return }
        if ready {
          self.loadRecordURL(url)
        } else {
          self.waitForServer(url, attempt: attempt + 1)
        }
      }
    }
  }

  private func loadRecordURL(_ url: URL) {
    statusLabel?.stringValue = "録画画面を読み込んでいます..."
    statusLabel?.isHidden = false
    webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120))
  }

  private func showServerStartError(_ message: String) {
    statusLabel?.stringValue = "ローカルサーバーを起動できませんでした"
    let error = NSError(
      domain: "ReactionStandeeWKPreview",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
    showLoadError(error)
  }

  private func buildMenu() {
    let mainMenu = NSMenu()

    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(NSMenuItem(title: "Reaction Standee WK Previewを終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)

    let windowMenuItem = NSMenuItem()
    let windowMenu = NSMenu(title: "Record")
    windowMenu.addItem(NSMenuItem(title: "録画画面を再読み込み", action: #selector(reloadRecordWindow), keyEquivalent: "r"))
    windowMenu.addItem(NSMenuItem(title: "録画URLを開き直す", action: #selector(reopenRecordWindow), keyEquivalent: "l"))
    windowMenu.addItem(NSMenuItem.separator())
    let settingsItem = NSMenuItem(title: "設定画面をSafariで開く", action: #selector(openSettingsInSafari), keyEquivalent: ",")
    settingsItem.keyEquivalentModifierMask = [.command]
    windowMenu.addItem(settingsItem)
    windowMenuItem.submenu = windowMenu
    mainMenu.addItem(windowMenuItem)

    NSApp.mainMenu = mainMenu
  }

  @available(macOS 12.0, *)
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.grant)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
