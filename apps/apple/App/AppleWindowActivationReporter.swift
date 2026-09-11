import SwiftUI

#if os(macOS)
import AppKit

struct WindowActivationReporter: NSViewRepresentable {
    let windowId: UUID
    @ObservedObject var commandCenter: AppleCommandCenter

    func makeCoordinator() -> Coordinator {
        Coordinator(windowId: windowId, commandCenter: commandCenter)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        context.coordinator.attach(to: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.windowId = windowId
        context.coordinator.commandCenter = commandCenter
        context.coordinator.attach(to: nsView)
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator {
        var windowId: UUID
        weak var commandCenter: AppleCommandCenter?
        private weak var window: NSWindow?
        private var activationObserver: NSObjectProtocol?
        private var closeObserver: NSObjectProtocol?
        private var registeredWindowId: UUID?
        private var attachmentGeneration: UInt64 = 0

        init(windowId: UUID, commandCenter: AppleCommandCenter) {
            self.windowId = windowId
            self.commandCenter = commandCenter
        }

        deinit {
            removeObservers()
        }

        func attach(to view: NSView) {
            attachmentGeneration &+= 1
            let generation = attachmentGeneration

            DispatchQueue.main.async { [weak self, weak view] in
                guard let self,
                      let view,
                      self.attachmentGeneration == generation else {
                    return
                }

                guard let nextWindow = view.window, self.window !== nextWindow else {
                    self.refreshWindowRegistration()
                    if view.window?.isKeyWindow == true {
                        self.commandCenter?.activateWindow(self.windowId)
                    }
                    return
                }

                self.unregisterCurrentWindow()
                self.removeObservers()

                self.window = nextWindow
                self.registeredWindowId = self.windowId
                self.commandCenter?.registerWindow(self.windowId)
                self.activationObserver = NotificationCenter.default.addObserver(
                    forName: NSWindow.didBecomeKeyNotification,
                    object: nextWindow,
                    queue: .main
                ) { [weak self] _ in
                    guard let self else { return }
                    self.commandCenter?.activateWindow(self.windowId)
                }
                self.closeObserver = NotificationCenter.default.addObserver(
                    forName: NSWindow.willCloseNotification,
                    object: nextWindow,
                    queue: .main
                ) { [weak self] _ in
                    self?.detach()
                }

                if nextWindow.isKeyWindow {
                    self.commandCenter?.activateWindow(self.windowId)
                }
            }
        }

        func detach() {
            attachmentGeneration &+= 1
            unregisterCurrentWindow()
            removeObservers()
            window = nil
        }

        private func refreshWindowRegistration() {
            guard registeredWindowId != windowId else { return }
            unregisterCurrentWindow()
            registeredWindowId = windowId
            commandCenter?.registerWindow(windowId)
        }

        private func unregisterCurrentWindow() {
            guard let registeredWindowId else { return }
            commandCenter?.unregisterWindow(registeredWindowId)
            self.registeredWindowId = nil
        }

        private func removeObservers() {
            if let activationObserver {
                NotificationCenter.default.removeObserver(activationObserver)
                self.activationObserver = nil
            }
            if let closeObserver {
                NotificationCenter.default.removeObserver(closeObserver)
                self.closeObserver = nil
            }
        }
    }
}
#endif
