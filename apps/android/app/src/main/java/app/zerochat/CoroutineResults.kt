package app.zerochat

import kotlinx.coroutines.CancellationException

internal inline fun <T> runCatchingPreservingCancellation(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        Result.failure(error)
    }

internal inline fun <T, R> Result<T>.mapCatchingPreservingCancellation(
    transform: (T) -> R,
): Result<R> = fold(
    onSuccess = { value -> runCatchingPreservingCancellation { transform(value) } },
    onFailure = { error ->
        if (error is CancellationException) {
            throw error
        }
        Result.failure(error)
    },
)
