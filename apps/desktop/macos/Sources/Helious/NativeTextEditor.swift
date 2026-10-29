import SwiftUI
import AppKit
struct NativeTextEditor: NSViewRepresentable {
    @Binding var text: String
    var fontSize: Double; var wrap: Bool
    func makeCoordinator() -> Coordinator {Coordinator(self)}
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = !wrap; scroll.autohidesScrollers = true; scroll.drawsBackground = false
        let editor = NSTextView(); editor.isRichText = false; editor.allowsUndo = true; editor.usesFindBar = true; editor.isAutomaticQuoteSubstitutionEnabled = false; editor.isAutomaticDashSubstitutionEnabled = false; editor.isAutomaticTextReplacementEnabled = false; editor.isAutomaticSpellingCorrectionEnabled = false; editor.drawsBackground = false; editor.textContainerInset = NSSize(width: 10, height: 12); editor.delegate = context.coordinator; editor.minSize = .zero; editor.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude); editor.isVerticallyResizable = true; editor.autoresizingMask = [.width]; scroll.documentView = editor
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? NSTextView else {return}
        context.coordinator.parent = self
        if editor.string != text {let selection = editor.selectedRanges; editor.string = text; editor.selectedRanges = selection.filter {NSMaxRange($0.rangeValue) <= (text as NSString).length}}
        editor.font = .monospacedSystemFont(ofSize: fontSize, weight: .regular); editor.textColor = .textColor
        editor.isHorizontallyResizable = !wrap; editor.textContainer?.widthTracksTextView = wrap
        editor.textContainer?.containerSize = NSSize(width: wrap ? max(100, scroll.contentSize.width) : CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        scroll.hasHorizontalScroller = !wrap
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeTextEditor
        init(_ parent: NativeTextEditor) {self.parent = parent}
        func textDidChange(_ notification: Notification) {if let editor = notification.object as? NSTextView {parent.text = editor.string}}
    }
}
