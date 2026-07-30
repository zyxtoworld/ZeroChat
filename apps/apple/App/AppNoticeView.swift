import SwiftUI

struct NoticeView: View {
    let notice: AppNotice

    var body: some View {
        Text(notice.message)
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var background: Color {
        switch notice.kind {
        case .success:
            Color.green.opacity(0.18)
        case .warning:
            Color.yellow.opacity(0.24)
        case .error:
            Color.red.opacity(0.18)
        }
    }
}

struct AppNotice {
    enum Kind {
        case success
        case warning
        case error
    }

    var message: String
    var kind: Kind
}
