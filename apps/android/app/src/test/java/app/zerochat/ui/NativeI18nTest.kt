package app.zerochat.ui

import app.zerochat.sync.SyncStatusNotifier
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NativeI18nTest {
    @Test
    fun languageModesKeepEverySupportedLocale() {
        assertEquals(
            listOf(
                "system",
                "zh-CN",
                "en-US",
                "es-ES",
                "hi-IN",
                "ar-SA",
                "pt-BR",
                "ru-RU",
                "ja-JP",
                "ko-KR",
                "fr-FR",
            ),
            NativeI18n.languageModes,
        )
    }

    @Test
    fun syncNotificationLabelsStayLocalized() {
        val zhLabels = NativeI18n.forMode("zh-CN").syncNotificationLabels()
        val enLabels = NativeI18n.forMode("en-US").syncNotificationLabels()

        assertEquals("同步状态", zhLabels.channelName)
        assertEquals("ZeroChat 同步", zhLabels.title)
        assertEquals("Sync status", enLabels.channelName)
        assertEquals("ZeroChat sync", enLabels.title)
        assertTrue(zhLabels.channelDescription.contains("端到端加密"))
        assertTrue(enLabels.channelDescription.contains("encrypted cloud sync"))
    }

    @Test
    fun cloudSyncEntryPointsStayDiscoverable() {
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        assertEquals("云同步", zh.t("setting.sync"))
        assertEquals("立即同步", zh.t("button.syncNow"))
        assertEquals("开启云同步", zh.t("action.startCloudSync"))
        assertEquals("填写 API Key", zh.t("action.addProviderKey"))
        assertEquals("添加模型", zh.t("action.addModel"))
        assertTrue(zh.t("sync.localSummary").contains("云同步未开启"))
        assertEquals("Cloud sync", en.t("setting.sync"))
        assertEquals("Sync now", en.t("button.syncNow"))
        assertEquals("Start cloud sync", en.t("action.startCloudSync"))
        assertEquals("Add provider key", en.t("action.addProviderKey"))
        assertEquals("Add model", en.t("action.addModel"))
        assertTrue(en.t("sync.localSummary").contains("Cloud sync is off"))
        assertTrue(zh.t("settings.changesSaved").contains("开启云同步后"))
        assertTrue(en.t("settings.changesSaved").contains("when enabled"))
        assertEquals("显示更多", zh.t("button.showMore"))
        assertEquals("Show more", en.t("button.showMore"))
        assertEquals("编辑服务商", zh.t("button.editProvider"))
        assertEquals("Edit provider", en.t("button.editProvider"))
        assertEquals("已显示 4/29 项", zh.t("settings.listProgress").replace("{shown}", "4").replace("{total}", "29"))
        assertEquals("Showing 4 of 29", en.t("settings.listProgress").replace("{shown}", "4").replace("{total}", "29"))
        assertEquals("已连接", zh.t("status.providerConnected"))
        assertEquals("未连接", zh.t("status.providerNotConnected"))
        assertEquals("Connected", en.t("status.providerConnected"))
        assertEquals("Not connected", en.t("status.providerNotConnected"))
        assertEquals("知道了", zh.t("featureHint.dismiss"))
        assertEquals("Got it", en.t("featureHint.dismiss"))
        assertTrue(zh.t("featureHint.provider-model").contains("服务商和模型"))
        assertTrue(en.t("featureHint.provider-model").contains("provider and model"))
    }

    @Test
    fun modelCapabilityLabelsStayLocalized() {
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        assertEquals("文字对话", zh.t("capability.chat"))
        assertEquals("图片生成", zh.t("capability.image-generation"))
        assertEquals("音频转写", zh.t("capability.audio-transcription"))
        assertEquals("图片理解", zh.t("capability.vision"))
        assertEquals("工具调用", zh.t("capability.tools"))
        assertEquals("模型列表", zh.t("capability.model-list"))
        assertEquals("Chat", en.t("capability.chat"))
        assertEquals("Image generation", en.t("capability.image-generation"))
        assertEquals("Audio transcription", en.t("capability.audio-transcription"))
        assertEquals("Vision", en.t("capability.vision"))
        assertEquals("Tool calling", en.t("capability.tools"))
        assertEquals("Model list", en.t("capability.model-list"))
    }

    @Test
    fun syncFieldHintsExplainCredentialPurpose() {
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        assertTrue(zh.t("settings.gistIdHint").contains("私有 Gist"))
        assertTrue(zh.t("settings.gistFileHint").contains("zerochat-sync.json"))
        assertTrue(zh.t("settings.githubTokenHint").contains("读写权限"))
        assertTrue(zh.t("settings.cloudflareWorkerUrlHint").contains("HTTPS 地址"))
        assertTrue(zh.t("settings.cloudflareAccessKeyFieldHint").contains("ZEROCHAT_ACCESS_KEY"))
        assertTrue(en.t("settings.gistIdHint").contains("private Gist"))
        assertTrue(en.t("settings.gistFileHint").contains("zerochat-sync.json"))
        assertTrue(en.t("settings.githubTokenHint").contains("read/write permission"))
        assertTrue(en.t("settings.cloudflareWorkerUrlHint").contains("HTTPS URL"))
        assertTrue(en.t("settings.cloudflareAccessKeyFieldHint").contains("ZEROCHAT_ACCESS_KEY"))
    }

    @Test
    fun providerFieldHintsExplainSetupPurpose() {
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        assertTrue(zh.t("settings.providerNameHint").contains("聊天标题"))
        assertTrue(zh.t("settings.providerBaseUrlHint").contains("Worker 地址"))
        assertTrue(zh.t("settings.providerKeyHint").contains("安全存储"))
        assertEquals("支持能力", zh.t("settings.capabilities"))
        assertEquals("接口", zh.t("settings.interfaces"))
        assertTrue(zh.t("settings.capabilityNote").contains("标准候选模型"))
        assertEquals("模型已覆盖", zh.t("settings.capabilityReadinessReady"))
        assertTrue(zh.t("settings.capabilityReadinessNote").contains("路由健康"))
        assertTrue(en.t("settings.providerNameHint").contains("model pickers"))
        assertTrue(en.t("settings.providerBaseUrlHint").contains("Worker URL"))
        assertTrue(en.t("settings.providerKeyHint").contains("secure storage"))
        assertEquals("Capabilities", en.t("settings.capabilities"))
        assertEquals("Interfaces", en.t("settings.interfaces"))
        assertTrue(en.t("settings.capabilityNote").contains("standard fallback model IDs"))
        assertEquals("Models covered", en.t("settings.capabilityReadinessReady"))
        assertTrue(en.t("settings.capabilityReadinessNote").contains("route health"))
    }

    @Test
    fun providerHttpErrorsStayHumanReadable() {
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        assertEquals(
            "API 余额不足，请充值后重试",
            zh.errorMessage("""AI request failed: {"error":{"code":"insufficient_quota"}} HTTP 402"""),
        )
        assertEquals(
            "API key is invalid. Check that it was copied completely.",
            en.errorMessage("""Model list request failed: {"error":"invalid API key"} HTTP 401"""),
        )
        assertEquals(
            "The provider could not complete the request. Try again later.",
            en.errorMessage("""Image generation request failed: {"error":{"message":"model does not exist"}}"""),
        )
        assertEquals(
            "This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.",
            en.errorMessage("""Audio speech request failed: {"error":{"message":"route not found"}} HTTP 404"""),
        )
    }

    @Test
    fun unknownErrorMessagesUseFixedLocalizedCopy() {
        val sentinel =
            "C:\\private\\backup\\secret.json /home/runner/.config/token https://provider.invalid/v1 " +
                "sk-test-not-a-real-key"

        val projected = NativeI18n.forMode("en-US").errorMessage(sentinel)

        assertEquals(
            NativeI18n.forMode("en-US").t("error.apiRequestFailed"),
            projected,
        )
        assertFalse(projected.contains("private"))
        assertFalse(projected.contains("runner"))
        assertFalse(projected.contains("provider.invalid"))
        assertFalse(projected.contains("sk-test-not-a-real-key"))
    }

    @Test
    fun cloudClearErrorDoesNotEchoAResponseBody() {
        val sentinel =
            "Cloud clear failed: C:\\private\\cloud\\secret.json /home/runner/.config/token " +
                "https://provider.invalid/v1 sk-test-not-a-real-key"

        val projected = NativeI18n.forMode("en-US").errorMessage(sentinel)

        assertEquals(
            NativeI18n.forMode("en-US").t("message.cloudClearFailedPrefix"),
            projected,
        )
        assertFalse(projected.contains("C:\\private"))
        assertFalse(projected.contains("/home/runner"))
        assertFalse(projected.contains("provider.invalid"))
        assertFalse(projected.contains("sk-test-not-a-real-key"))
    }

    @Test
    fun incrementalCloudSyncErrorsDoNotEchoAResponseBody() {
        val sentinel =
            "C:\\private\\sync\\secret.json /home/runner/.config/token " +
                "https://provider.invalid/v1 sk-test-not-a-real-key"
        val i18n = NativeI18n.forMode("en-US")

        val checkFailure = i18n.errorMessage(
            "Cloud incremental sync check failed: $sentinel",
        )
        val stepFailure = i18n.errorMessage(
            "Cloud incremental object request failed: $sentinel",
        )

        assertEquals(i18n.t("error.cloudIncrementalCheckFailedPrefix"), checkFailure)
        assertEquals(i18n.t("error.cloudSyncStepFailedPrefix"), stepFailure)
        assertFalse(checkFailure.contains("provider.invalid"))
        assertFalse(stepFailure.contains("sk-test-not-a-real-key"))
    }

    @Test
    fun mockkCanVerifyNativeSyncNotifierContract() {
        val notifier = mockk<SyncStatusNotifier>(relaxed = true)
        val title = NativeI18n.forMode("en-US").syncNotificationLabels().title

        notifier.showStatus(title, completed = true)

        verify(exactly = 1) {
            notifier.showStatus("ZeroChat sync", completed = true)
        }
    }
}
