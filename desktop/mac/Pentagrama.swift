import Cocoa
import WebKit

// A real macOS application: one native window, no Terminal and no external
// browser. The bundled private service exists only while this app is open.
final class PentagramaApplication: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let port = 8787 // Keep stable: the score library uses origin-scoped localStorage.
    private var window: NSWindow!
    private var web: WKWebView!
    private var service: Process?
    private var stopping = false
    private var logFile: FileHandle?

    private var rootURL: URL {
        URL(string: "http://127.0.0.1:\(port)/index.html")!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1250, height: 820), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.autoresizingMask = [.width, .height]
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1250, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Pentagrama"
        window.minSize = NSSize(width: 800, height: 560)
        window.center()
        window.delegate = self
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        launchService()
    }

    private func error(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "No se pudo abrir Pentagrama"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Cerrar")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func launchService() {
        guard let resources = Bundle.main.resourceURL else {
            error("Falta la carpeta de recursos de la aplicación.")
            return
        }
        let executable = resources.appendingPathComponent("PentagramaServer/PentagramaServer")
        let audiveris = resources.appendingPathComponent("Audiveris.app/Contents/MacOS/Audiveris")
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              FileManager.default.isExecutableFile(atPath: audiveris.path) else {
            error("Falta un componente incluido en Pentagrama. Copia la aplicación completa a Aplicaciones y vuelve a abrirla.")
            return
        }
        let logDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Pentagrama", isDirectory: true)
        try? FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let log = logDirectory.appendingPathComponent("pentagrama.log")
        if !FileManager.default.fileExists(atPath: log.path) {
            FileManager.default.createFile(atPath: log.path, contents: nil)
        }
        logFile = FileHandle(forWritingAtPath: log.path)
        logFile?.seekToEndOfFile()
        let process = Process()
        process.executableURL = executable
        process.currentDirectoryURL = resources
        var env = ProcessInfo.processInfo.environment
        env["AUDIVERIS_BIN"] = audiveris.path
        env["PYTHONUNBUFFERED"] = "1"
        process.environment = env
        process.standardOutput = logFile ?? FileHandle.nullDevice
        process.standardError = logFile ?? FileHandle.nullDevice
        service = process
        do {
            try process.run()
        } catch {
            self.error("No se pudo iniciar el motor local: \(error.localizedDescription). Registro: \(log.path)")
            return
        }
        // Never connect to an unrelated server running on the fixed port.
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                self.error("El motor local se cerró. Cierra cualquier versión anterior que use el puerto 8787 y vuelve a abrir Pentagrama. Registro: \(log.path)")
            }
        }
        waitForService(remaining: 90)
    }

    private func waitForService(remaining: Int) {
        guard !stopping else { return }
        guard let process = service, process.isRunning else { return }
        let url = URL(string: "http://127.0.0.1:\(port)/api/omr/health")!
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                if self.service?.isRunning == true,
                   let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   json["available"] as? Bool == true {
                    self.web.load(URLRequest(url: self.rootURL))
                } else if remaining > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self.waitForService(remaining: remaining - 1)
                    }
                } else {
                    self.error("Audiveris no respondió. Comprueba que ninguna versión anterior de Pentagrama esté abierta. Consulta ~/Library/Logs/Pentagrama/pentagrama.log.")
                }
            }
        }.resume()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.scheme == "http" && url.host == "127.0.0.1" && url.port == port) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            // External informational links are optional; editor and conversion
            // never require them or open a remote page inside the app.
            if navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
        }
    }

    // WKWebView must forward browser dialogs: PDF import confirms replacing
    // the current score and the original editor also uses confirm()/alert().
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Pentagrama"
        alert.informativeText = message
        alert.addButton(withTitle: "Aceptar")
        alert.addButton(withTitle: "Cancelar")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Pentagrama"
        alert.informativeText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Pentagrama"
        alert.informativeText = prompt
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "Aceptar")
        alert.addButton(withTitle: "Cancelar")
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    // Native PDF file picker, not a browser tab or an external helper.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }

    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        if let process = service, process.isRunning { process.terminate() }
        logFile?.closeFile()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = PentagramaApplication()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
