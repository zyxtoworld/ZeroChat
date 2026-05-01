import SwiftUI

struct ChatView: View {
    @State private var input = ""

    var body: some View {
        NavigationSplitView {
            List {
                Text("新对话")
            }
            .navigationTitle("ZeroChat")
        } detail: {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("选择模型并开始对话")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }

                HStack {
                    TextField("输入消息", text: $input, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                    Button("发送") {
                        input = ""
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
            }
            .navigationTitle("新对话")
        }
    }
}
