package app.zerochat.ui.chat

internal inline fun <T> initializeResourceOrRelease(
    resource: T,
    release: T.() -> Unit,
    initialize: T.() -> Unit,
): T = try {
    resource.initialize()
    resource
} catch (error: Throwable) {
    try {
        resource.release()
    } catch (releaseError: Throwable) {
        error.addSuppressed(releaseError)
    }
    throw error
}
