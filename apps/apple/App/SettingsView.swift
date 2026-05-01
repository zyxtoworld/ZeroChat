import SwiftUI

struct SettingsView: View {
    @State private var baseURL = "https://api.openai.com/v1"
    @State private var model = ""
    @State private var proxyURL = ""

    var body: some View {
        Form {
            Section("模型") {
                TextField("Base URL", text: $baseURL)
                TextField("模型", text: $model)
                SecureField("API Key", text: .constant(""))
                TextField("代理地址", text: $proxyURL)
            }

            Section("同步") {
                Picker("同步方式", selection: .constant("local")) {
                    Text("本地").tag("local")
                    Text("GitHub Gist").tag("gist")
                    Text("Cloudflare").tag("cloudflare")
                }
                SecureField("同步密钥", text: .constant(""))
            }
        }
        .navigationTitle("设置")
    }
}
